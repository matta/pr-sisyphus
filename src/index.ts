import { Probot, Context, ApplicationFunctionOptions } from "probot";

// Configuration
const LABELS = {
  TRIGGER: "ready-to-merge",
  LOCK: "processing-merge",
  CONFLICT: "error-conflict",
  FAIL: "error-ci",
};

const STALE_LOCK_MINUTES = 15;

/**
 * The main Probot application entry point.
 * Manages PR merge queues, stuck locks, and conflicts.
 */
export default (app: Probot, { addHandler }: ApplicationFunctionOptions) => {
  app.log.info("Merge Helper Bot loaded");

  // 1. EVENT LISTENERS (The "Push")
  
  // Trigger when you signal intent or when the PR state changes
  app.on(
    [
      "pull_request.labeled",
      "pull_request.synchronize",
      "check_run.completed",
      "pull_request.review_request_removed", // Sometimes relevant for state changes
    ],
    async (context) => {
      // For check_run, we need to lookup the PR, so we just run the repo sweeper
      // to be safe and simple.
      const { owner, repo } = context.repo();
      await processRepo(context.octokit, owner, repo, context.log);
    }
  );

  // 2. THE SWEEPER (The "Pull" / Reconciliation)
  
  if (addHandler) {
    addHandler(async (req, res) => {
      if (req.method === "GET" && req.url === "/pr-sisyphus/scheduler") {
        app.log.info("Scheduled sweep initiated");
        try {
          const appOctokit = await app.auth();
          const installations = await appOctokit.paginate("GET /app/installations", { per_page: 100 });

          for (const installation of installations) {
            try {
              const installationOctokit = await app.auth(installation.id);
              const repos = await installationOctokit.paginate("GET /installation/repositories", { per_page: 100 });

              for (const repo of repos) {
                await processRepo(installationOctokit, repo.owner.login, repo.name, app.log);
              }
            } catch (e) {
              app.log.error(`Failed to process installation ${installation.id}: ${e}`);
            }
          }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end("Scheduled sweep completed.");
        } catch (e: any) {
          app.log.error(`Scheduled sweep failed: ${e}`);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end("Scheduled sweep failed");
        }
        return true;
      }
      return false;
    });
  }

  // ----------------------------------------------------------------------
  // 3. THE EXECUTOR (Core Logic)
  // ----------------------------------------------------------------------

  async function processRepo(octokit: Context['octokit'], owner: string, repo: string, log: Context['log']) {
    const logger = log.child({ repo: `${owner}/${repo}` });

    // A. CHECK FOR STUCK LOCKS
    // ------------------------
    const lockedPrs = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open label:"${LABELS.LOCK}"`,
    });

    if (lockedPrs.data.total_count > 0) {
      const lockedPr = lockedPrs.data.items[0];
      
      // Check if stale
      // (Using the simplified logic that 'updated_at' reflects label time closely enough for this MVP)
      const lastUpdate = new Date(lockedPr.updated_at).getTime();
      const now = new Date().getTime();
      const diffMins = (now - lastUpdate) / 1000 / 60;

      if (diffMins > STALE_LOCK_MINUTES) {
        logger.warn(`Found stale lock on PR #${lockedPr.number}. Releasing.`);
        await octokit.rest.issues.removeLabel({
          owner, repo, issue_number: lockedPr.number, name: LABELS.LOCK
        });
        await octokit.rest.issues.createComment({
          owner, repo, issue_number: lockedPr.number, 
          body: "🤖 **Merge Bot:** Automation was stuck. I have reset the lock. Waiting for next cycle."
        });
        // Continue to let the next logic pick it up immediately
      } else {
        logger.info(`Repo is busy processing PR #${lockedPr.number}. Skipping.`);
        return; // Busy, come back later
      }
    }

    // B. FIND NEXT CANDIDATE (FIFO)
    // -----------------------------
    const candidates = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open label:"${LABELS.TRIGGER}" -label:"${LABELS.LOCK}" sort:created-asc`,
    });

    if (candidates.data.total_count === 0) {
      return; // Nothing to do
    }

    const prNumber = candidates.data.items[0].number;
    
    // C. ENGAGE (Apply Lock)
    // ----------------------
    await octokit.rest.issues.addLabels({
      owner, repo, issue_number: prNumber, labels: [LABELS.LOCK]
    });
    
    // Fetch full PR details (search results are partial)
    const { data: pr } = await octokit.rest.pulls.get({
      owner, repo, pull_number: prNumber
    });

    // D. EVALUATE STATE
    // -----------------
    
    // Case 1: Conflicts
    if (pr.mergeable_state === "dirty") {
      await failPr(octokit, owner, repo, prNumber, LABELS.CONFLICT, "Merge conflicts detected. Please resolve manually.");
      return;
    }

    // Case 2: Behind Main
    if (pr.mergeable_state === "behind") {
      logger.info(`PR #${prNumber} is behind. Updating branch.`);
      try {
        await octokit.rest.pulls.updateBranch({
          owner, repo, pull_number: prNumber
        });
        // We stop here. The update triggers a 'synchronize' event (and CI), 
        // which will call this function again.
        return; 
      } catch (e) {
        // Sometimes update fails if the branch was just updated
        logger.error(e);
        return;
      }
    }

    // Case 3: CI Status
    // If you don't use Branch Protection, 'mergeable_state' might report 'clean' even if CI failed.
    // We must manually check CI.
    const checks = await octokit.rest.checks.listForRef({
      owner, repo, ref: pr.head.sha
    });

    const anyFailed = checks.data.check_runs.some(
      (run) => run.conclusion === "failure" || run.conclusion === "timed_out"
    );
    const anyPending = checks.data.check_runs.some(
      (run) => run.status === "in_progress" || run.status === "queued"
    );

    if (anyFailed) {
      await failPr(octokit, owner, repo, prNumber, LABELS.FAIL, "CI checks failed. Please fix and re-apply label.");
      return;
    }

    if (anyPending) {
      logger.info(`PR #${prNumber} is waiting on CI.`);
      return; // Wait for check_run.completed
    }

    // Case 4: Ready to Merge
    // (We rely on 'clean' or 'has_hooks' - GitHub is weird about exact states sometimes)
    if (["clean", "has_hooks", "unstable"].includes(pr.mergeable_state)) {
       logger.info(`Merging PR #${prNumber}`);
       try {
         await octokit.rest.pulls.merge({
           owner, repo, pull_number: prNumber, merge_method: "squash"
         });
         
         // Cleanup
         // GitHub automatically closes the PR, but we should remove our trigger label
         // (The lock label doesn't strictly need removal on closed PRs, but it's tidy)
         // Note: merging closes the PR, so 'is:open' search won't find it next time.
       } catch (e) {
         logger.error(`Merge failed: ${e}`);
         // Don't fail the PR yet, could be a transient API error.
       }
    } else {
       logger.info(`PR #${prNumber} state is '${pr.mergeable_state}'. Waiting.`);
    }
  }

  // Helper to "Kick back" the PR to the user
  async function failPr(octokit: Context['octokit'], owner: string, repo: string, prNumber: number, label: string, message: string) {
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: prNumber, body: `🤖 **Merge Bot:** ${message}`
    });
    await octokit.rest.issues.addLabels({
      owner, repo, issue_number: prNumber, labels: [label]
    });
    // Remove the trigger and lock so we don't loop
    await octokit.rest.issues.removeLabel({
      owner, repo, issue_number: prNumber, name: LABELS.TRIGGER
    });
    await octokit.rest.issues.removeLabel({
      owner, repo, issue_number: prNumber, name: LABELS.LOCK
    });
  }
};