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
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  };
  export default fs;
}

declare module "path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module "url" {
  export function fileURLToPath(url: string): string;
}

declare module "fs" {
  export function existsSync(path: string): boolean;
}

declare module "dotenv/config" {}

declare module "cors" {
  const cors: (options?: { origin?: string | string[] | boolean }) => unknown;
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
    sendFile(path: string): void;
    headersSent: boolean;
  }
  export type NextFunction = () => void;
  export type ErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => unknown;
  export type Handler = (req: Request, res: Response) => unknown;
  export type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;
  export interface RouterLike {
    use(...args: unknown[]): unknown;
    get(path: string, handler: Handler): unknown;
    get(path: string, middleware: Middleware, handler: Handler): unknown;
    post(path: string, handler: Handler): unknown;
    post(path: string, middleware: Middleware, handler: Handler): unknown;
    put(path: string, handler: Handler): unknown;
    delete(path: string, handler: Handler): unknown;
  }
  export function Router(): RouterLike;
  interface HttpServer {
    close(cb?: () => void): void;
  }
  interface Express extends RouterLike {
    listen(port: number | string, cb?: () => void): HttpServer;
  }
  interface ExpressFactory {
    (): Express;
    json(options?: { limit?: string }): unknown;
    static(root: string): unknown;
  }
  const express: ExpressFactory;
  export default express;
}

declare module "react" {
  export const StrictMode: unknown;
  export function useMemo<T>(factory: () => T, deps: unknown[]): T;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
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
