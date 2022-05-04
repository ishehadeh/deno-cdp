import { ProtocolMapping } from "https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/3a7051b8312a66c3e37a5d1b3981396ff49de36b/types/protocol-mapping.d.ts";

type RequestID = string | number;

export interface Request<P = unknown> {
  id: RequestID;
  sessionId?: string;
  method: string;
  params: P;
}

export type ResponseError<E> = {
  id: RequestID;
  error: {
    code?: number;
    message: string;
    data: E;
  };
};

export type ResponseSuccess<T> = {
  id: RequestID;
  result: T;
};

export type Response<T = unknown, E = unknown> =
  | ResponseSuccess<T>
  | ResponseError<E>;

export type Event<T = unknown> = {
  method: string;
  params: T;
};

export function isResponse(obj: unknown): obj is Response {
  return obj != null && typeof obj == "object" &&
    "id" in obj && ("result" in obj || "error" in obj);
}

export function isEvent(obj: unknown): obj is Event {
  return obj != null && typeof obj == "object" &&
    "method" in obj && "params" in obj &&
    !("id" in obj);
}

export function isResponseError(
  resp: Response,
): resp is ResponseError<unknown> {
  return (resp as ResponseError<unknown>).error != undefined;
}

export function isResponseSuccess(
  resp: Response,
): resp is ResponseSuccess<unknown> {
  return (resp as ResponseSuccess<unknown>).result != undefined;
}

export class RequestFailed<P, E> extends Error {
  request: Request<P>;
  response: ResponseError<E>;

  constructor(req: Request<P>, resp: ResponseError<E>) {
    super(`Request Failed: ${resp.error.message}`);

    this.request = req;
    this.response = resp;
  }
}

export class Client {
  _conn: WebSocket;
  _responseHandlers: Record<RequestID, (_: any) => void> = {};
  _eventHandlers: Record<string, (e: string, p: unknown) => void> = {};

  static connect(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new WebSocket(url);

      conn.addEventListener("open", (_ev) => {
        resolve(new Client(conn));
      });

      conn.addEventListener("error", (error) => {
        reject((<ErrorEvent> error).error);
      }, { once: true });
    });
  }

  constructor(conn: WebSocket) {
    this._conn = conn;
    this._conn.addEventListener("message", (event) => {
      const obj = JSON.parse(event.data);
      if (isResponse(obj)) {
        this._responseHandler(obj);
      } else if (isEvent(obj)) {
        if (obj.method in this._eventHandlers) {
          this._eventHandlers[obj.method](obj.method, obj.params);
        }
      } else {
        console.log("no handler for message: ", event);
      }
    });
  }

  on<E extends keyof ProtocolMapping.Events>(
    event: E,
    cb: (method: E, params: ProtocolMapping.Events[E]) => void,
  ): void {
    this._eventHandlers[event] = <(_0: string, _1: unknown) => void> cb;
  }

  _responseHandler(resp: Response): void {
    const callback = this._responseHandlers[resp.id];
    if (!callback) {
      console.warn(
        `cdp.Client: recieved a response for request '${resp.id}' but no outstanding request with that ID exists`,
      );
      return;
    }

    callback(resp);
  }

  _makeRequestID(): RequestID {
    return crypto.randomUUID();
  }

  close(): void {
    this._conn.close();
  }

  _send<P, R, E>(req: Request<P>): Promise<Response<R, E>> {
    return new Promise((resolve, _reject) => {
      this._responseHandlers[req.id] = resolve;
      this._conn.send(JSON.stringify(req));
    });
  }

  async call<M extends keyof ProtocolMapping.Commands>(
    method: M,
    params: ProtocolMapping.Commands[M]["paramsType"][0],
    sessionId?: string,
  ): Promise<ProtocolMapping.Commands[M]["returnType"]> {
    const req = {
      id: this._makeRequestID(),
      params,
      method,
      sessionId,
    };
    const resp: Response<ProtocolMapping.Commands[M]["returnType"], unknown> =
      await this._send(req);
    console.log(resp);
    if (isResponseError(resp)) {
      throw new RequestFailed(req, resp);
    }

    return resp.result;
  }
}
