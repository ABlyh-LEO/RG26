import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { eventFileSchema } from '../../src/domain/schema';
import { OPERATOR_API, type SessionResponse } from '../../src/operator/contracts';
import { OperatorError, safeMessage } from './errors';
import type { OperatorService } from './service';

const version = z.object({ expectedVersion: z.number().int().positive() }).strict();
const save = version.extend({ event: eventFileSchema,
  formInputs: z.record(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional(),
  message: z.string().max(300).optional(), migrationRequiresReview: z.boolean().optional() });
const publish = version.extend({ previewId: z.string().uuid(), message: z.string().min(1).max(300).optional() });
const sessionRequest = z.object({ clientId: z.string().min(8).max(128), takeover: z.boolean().optional() }).strict();
interface Session { clientId: string; token: string; id: string; lastSeen: number }

async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new OperatorError('CONTENT_TYPE', '请求必须使用 JSON。', 415);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer); bytes += buffer.length;
    if (bytes > 2 * 1024 * 1024) throw new OperatorError('BODY_TOO_LARGE', '请求超过 2 MB。', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new OperatorError('INVALID_JSON', '请求不是有效 JSON。'); }
}
export function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

export function createOperatorApi(service: OperatorService, origin: string) {
  const expectedHost = new URL(origin).host;
  const sessions = new Map<string, Session>();
  let writer: Session | null = null;

  function guard(req: IncomingMessage, mutation: boolean): void {
    if (req.headers.host !== expectedHost) throw new OperatorError('BAD_HOST', '仅允许本机维护地址。', 403);
    const peer = req.socket.remoteAddress;
    if (peer && peer !== '127.0.0.1' && peer !== '::ffff:127.0.0.1' && peer !== '::1') throw new OperatorError('NOT_LOCAL', '维护工具仅接受本机连接。', 403);
    const requestOrigin = req.headers.origin;
    if ((mutation && requestOrigin !== origin) || (requestOrigin && requestOrigin !== origin)) throw new OperatorError('BAD_ORIGIN', '请求来源与维护工具不一致。', 403);
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new OperatorError('CROSS_SITE', '拒绝跨站访问维护工具。', 403);
  }
  function authenticate(req: IncomingMessage, write: boolean): Session {
    const token = Buffer.from(String(req.headers['x-operator-token'] ?? ''));
    const match = [...sessions.values()].find((session) => Buffer.byteLength(session.token) === token.length && timingSafeEqual(Buffer.from(session.token), token));
    if (!match) throw new OperatorError('SESSION_REQUIRED', '本机会话已过期，请重新连接。', 401);
    if (write && writer !== match) throw new OperatorError('READ_ONLY', '另一页面正在编辑；请先接管编辑会话。', 403);
    match.lastSeen = Date.now();
    return match;
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? '/', origin).pathname;
    if (!path.startsWith(OPERATOR_API)) return false;
    try {
      const mutation = req.method !== 'GET';
      guard(req, mutation);
      if (path === `${OPERATOR_API}/session` && req.method === 'POST') {
        const input = sessionRequest.parse(await body(req));
        let session = sessions.get(input.clientId);
        if (!session) {
          session = { clientId: input.clientId, token: randomBytes(32).toString('hex'), id: randomUUID(), lastSeen: Date.now() };
          sessions.set(input.clientId, session);
        }
        if (!writer || writer.clientId === input.clientId || Date.now() - writer.lastSeen > 120_000 || input.takeover) writer = session;
        session.lastSeen = Date.now();
        const state = await service.state(writer !== session);
        const response: SessionResponse = { ...state, token: session.token, sessionId: session.id };
        json(res, 200, response); return true;
      }
      const session = authenticate(req, mutation);
      const input = mutation ? await body(req) : undefined;
      if (path === `${OPERATOR_API}/state` && req.method === 'GET') json(res, 200, await service.state(writer !== session));
      else if (path === `${OPERATOR_API}/draft` && req.method === 'PUT') json(res, 200, await service.save(save.parse(input)));
      else if (path === `${OPERATOR_API}/draft/reset` && req.method === 'POST') json(res, 200, await service.reset(version.parse(input).expectedVersion));
      else if (path === `${OPERATOR_API}/sync` && req.method === 'POST') json(res, 200, await service.sync(version.parse(input).expectedVersion));
      else if (path === `${OPERATOR_API}/validate` && req.method === 'POST') json(res, 200, await service.validate(version.parse(input).expectedVersion));
      else if (path === `${OPERATOR_API}/preview` && req.method === 'POST') json(res, 200, await service.preview(version.parse(input).expectedVersion));
      else if (path === `${OPERATOR_API}/publish` && req.method === 'POST') json(res, 202, await service.publish(publish.parse(input)));
      else if (path === `${OPERATOR_API}/jobs` && req.method === 'GET') json(res, 200, (await service.state()).jobs);
      else {
        const action = /^\/api\/operator\/jobs\/([a-f0-9-]+)\/(retry|check)$/.exec(path);
        if (!action || req.method !== 'POST') throw new OperatorError('NOT_FOUND', '没有找到这个维护接口。', 404);
        json(res, 200, action[2] === 'retry' ? await service.retry(action[1]!) : await service.checkLive(action[1]!));
      }
    } catch (error) {
      if (error instanceof z.ZodError) json(res, 422, { error: { code: 'SCHEMA', message: '请求数据不符合格式。', details: error.issues } });
      else if (error instanceof OperatorError) json(res, error.status, { error: { code: error.code, message: error.message, details: error.details } });
      else json(res, 500, { error: { code: 'INTERNAL', message: safeMessage(error) } });
    }
    return true;
  };
}
