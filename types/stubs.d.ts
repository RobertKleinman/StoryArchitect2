declare const process: {
  env: Record<string, string | undefined>;
};

declare module "fs/promises" {
  const fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readFile(path: string, encoding: string): Promise<string>;
    writeFile(path: string, data: string, encoding?: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    unlink(path: string): Promise<void>;
  };
  export default fs;
}

declare module "path" {
  export function join(...paths: string[]): string;
}

declare module "dotenv/config" {}

declare module "cors" {
  const cors: () => unknown;
  export default cors;
}

declare module "express" {
  export interface Request {
    body?: any;
    params: Record<string, string>;
    header(name: string): string | string[] | undefined;
  }
  export interface Response {
    status(code: number): Response;
    json(data: unknown): Response;
  }
  export type NextFunction = () => void;
  export type Handler = (req: Request, res: Response) => unknown;
  export interface RouterLike {
    use(...args: unknown[]): unknown;
    get(path: string, handler: Handler): unknown;
    post(path: string, handler: Handler): unknown;
    put(path: string, handler: Handler): unknown;
    delete(path: string, handler: Handler): unknown;
  }
  export function Router(): RouterLike;
  interface Express extends RouterLike {
    listen(port: number | string, cb?: () => void): void;
  }
  interface ExpressFactory {
    (): Express;
    json(): unknown;
  }
  const express: ExpressFactory;
  export default express;
}

declare module "react" {
  export const StrictMode: unknown;
  export function useMemo<T>(factory: () => T, deps: unknown[]): T;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  const React: any;
  export default React;
}

declare module "react/jsx-runtime" {
  export const Fragment: unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

declare module "react-dom/client" {
  export function createRoot(el: Element): { render(node: unknown): void };
}

declare module "vite" {
  export function defineConfig(config: unknown): unknown;
}

declare module "@vitejs/plugin-react" {
  const react: () => unknown;
  export default react;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: {
      [key: string]: any;
      onChange?: (event: any) => any;
      onClick?: (event: any) => any;
    };
  }
}
