import nock from "nock";
import myProbotApp from "../src/index.js";
import { Probot, ProbotOctokit } from "probot";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

describe("Cleanup Labels After Merge", () => {
  let probot: Probot;
  let handler: any;

  beforeEach(async () => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    
    const addHandler = (h: any) => {
      handler = h;
    };

    await probot.load(myProbotApp, { addHandler, cwd: process.cwd() });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("removes trigger and lock labels after successful merge", async () => {
    const owner = "matta";
    const repo = "pr-sisyphus";
    const prNumber = 123;
    const sha = "abcdef";

    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(201, { token: "test" }) // Probot expects 201 for tokens

      // Scheduler discovery
      .get("/app/installations")
      .query({ per_page: 100 })
      .reply(200, [{ id: 2 }])

      .get("/installation/repositories")
      .query({ per_page: 100 })
      .reply(200, { repositories: [{ name: repo, owner: { login: owner } }] })

      // Search for locked PRs
      .get("/search/issues")
      .query((q: any) => typeof q.q === 'string' && q.q.includes('label:"processing-merge"'))
      .reply(200, { total_count: 0, items: [] })

      // Search for candidates
      .get("/search/issues")
      .query((q: any) => typeof q.q === 'string' && q.q.includes('label:"ready-to-merge"'))
      .reply(200, { total_count: 1, items: [{ number: prNumber }] })

      // Apply lock
      .post(`/repos/${owner}/${repo}/issues/${prNumber}/labels`, body => {
        return body.labels.includes("processing-merge");
      })
      .reply(200)

      // Get PR details
      .get(`/repos/${owner}/${repo}/pulls/${prNumber}`)
      .reply(200, {
        number: prNumber,
        head: { sha },
        mergeable_state: "clean"
      })

      // List checks
      .get(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
      .reply(200, { check_runs: [] })

      // Merge PR
      .put(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`)
      .reply(200)

      // EXPECTED CLEANUP: Remove labels
      .delete(`/repos/${owner}/${repo}/issues/${prNumber}/labels/ready-to-merge`)
      .reply(200)
      .delete(`/repos/${owner}/${repo}/issues/${prNumber}/labels/processing-merge`)
      .reply(200);

    let resolveResponse: (value: unknown) => void;
    const responsePromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });

    const res = {
      send: vi.fn().mockImplementation((val) => {
        resolveResponse(val);
        return res;
      }),
      status: vi.fn().mockReturnThis(),
      writeHead: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockImplementation((val) => {
        resolveResponse(val);
        return res;
      }),
    };

    const req = {
      method: "GET",
      url: "/pr-sisyphus/scheduler",
    };

    await handler(req, res, () => {});
    await responsePromise;

    expect(mock.pendingMocks()).toStrictEqual([]);
  }, 10000);
});
