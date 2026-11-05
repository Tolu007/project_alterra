import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './api';

// Vercel's entry point: every /api request lands here.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res);
}
