// You can import your modules
// import index from '../src/index'

import nock from "nock";
// Requiring our app implementation
import myProbotApp from "../src/index.js";
import { Probot, ProbotOctokit } from "probot";
// Requiring our fixtures
//import payload from "./fixtures/issues.opened.json" with { "type": "json"};
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

describe("My Probot app", () => {
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    // Load our app into probot
    probot.load(myProbotApp);
  });

  test("receives pull_request.labeled event", async () => {
    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          pull_requests: "write",
        },
      })
      
      // The app will search for locked PRs
      .get("/search/issues?q=repo%3Ahiimbex%2Ftesting-things%20is%3Apr%20is%3Aopen%20label%3A%22processing-merge%22")
      .reply(200, { total_count: 0, items: [] })

      // Then it searches for candidates
      .get("/search/issues?q=repo%3Ahiimbex%2Ftesting-things%20is%3Apr%20is%3Aopen%20label%3A%22ready-to-merge%22%20-label%3A%22processing-merge%22%20sort%3Acreated-asc")
      .reply(200, { total_count: 0, items: [] });

    await probot.receive({
      name: "pull_request",
      payload: {
        action: "labeled",
        pull_request: {
          number: 1,
          user: { login: "hiimbex" },
          head: { sha: "123456" },
          base: { ref: "main" },
          state: "open",
        },
        repository: {
          name: "testing-things",
          owner: { login: "hiimbex" },
        },
        installation: { id: 2 },
      },
    });

    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about using TypeScript in your tests, Jest recommends:
// https://github.com/kulshekhar/ts-jest

// For more information about testing with Nock see:
// https://github.com/nock/nock
