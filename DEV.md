# Development Guide

This guide describes how to set up your development environment for `pr-sisyphus`.

## Prerequisites

*   **Node.js**: This project requires Node.js version 24 or higher.
    *   We recommend using [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) to manage your Node.js versions.
    *   This project includes an `.nvmrc` file. If you have `nvm` installed, you can simply run `nvm use` in the project root to switch to the correct version.

## Setup

1.  **Clone the repository**:
    ```sh
    git clone <repository-url>
    cd pr-sisyphus
    ```

2.  **Install dependencies**:
    ```sh
    npm install
    ```

## Configuration

1.  **Environment Variables**:
    Copy the example environment file to `.env`:
    ```sh
    cp .env.example .env
    ```
    Open `.env` and fill in the required values (e.g., `APP_ID`, `WEBHOOK_SECRET`).

## Building

To compile the TypeScript source code to JavaScript, run:

```sh
npm run build
```

This will output the compiled files to the `lib/` directory.

## Testing

To run the test suite, use:

```sh
npm test
```

This will run `vitest` to execute the tests located in the `test/` directory.
