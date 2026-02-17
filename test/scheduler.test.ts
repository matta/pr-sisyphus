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

describe("Scheduler Route", () => {
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

    // Capture the handler passed to addHandler
    const addHandler = (h: any) => {
      handler = h;
    };

    await probot.load(myProbotApp, { addHandler, cwd: process.cwd() });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("GET /pr-sisyphus/scheduler triggers sweep", async () => {
    // 1. Mock the app authentication (paginate GET /app/installations)
    nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test" })
      .get("/app/installations")
      .query({ per_page: 100 })
      .reply(200, [{ id: 2 }]);

    // 2. Mock the installation authentication (paginate GET /installation/repositories)
    nock("https://api.github.com")
      .get("/installation/repositories")
      .query({ per_page: 100 })
      .reply(200, {
        repositories: [
          { name: "repo1", owner: { login: "owner1" } }
        ]
      });

    // 3. Mock the search for locked PRs
    nock("https://api.github.com")
      .get("/search/issues")
      .query({ q: 'repo:owner1/repo1 is:pr is:open label:"processing-merge"' })
      .reply(200, { total_count: 0, items: [] });

    // 4. Mock the search for candidates
    nock("https://api.github.com")
      .get("/search/issues")
      .query({ q: 'repo:owner1/repo1 is:pr is:open label:"ready-to-merge" -label:"processing-merge" sort:created-asc' })
      .reply(200, { total_count: 0, items: [] });

    // Mock response object
    // Mock response object with a promise to wait for completion
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

    // Mock request object
    const req = {
      method: "GET",
      url: "/pr-sisyphus/scheduler",
    };

    // Call the handler
    await handler(req, res, () => {});
    
    // Wait for the response to be sent
    await responsePromise;

    expect(res.end).toHaveBeenCalledWith("Scheduled sweep completed.");
  });
});
