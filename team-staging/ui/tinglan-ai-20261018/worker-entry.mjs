import core, { ReviewService as CoreReviewService } from '../../../chenchen/deployment/worker.js';
import { createGateway, reserveUser, failure } from './gateway.mjs';

// Keep the same Durable Object class name and existing migration history.
export class ReviewService extends CoreReviewService {
  async handle(request) {
    if (new URL(request.url).pathname === '/_tinglan/usage' && request.method === 'GET') {
      if (!this.env.CORE_AGENT_API_KEY || request.headers.get('X-Core-Agent-Key') !== this.env.CORE_AGENT_API_KEY) return failure('AUTHENTICATION_REQUIRED',401);
      try {
        const records = await this.storage.list({ prefix:'bailian-attempt:', limit:20 });
        return Response.json({ budget:await this.storage.get('bailian-budget:v1') || null, attempts:[...records.values()].map(value=>({ status:value.status,model:value.model,errorCode:value.error_code||null,usage:value.usage,elapsedMs:value.elapsed_ms,responseId:value.provider_response_id||null,reservedCny:value.reserved_cny })) }, { headers:{'Cache-Control':'no-store'} });
      } catch { return failure('SERVICE_UNAVAILABLE',503); }
    }
    const subject = request.headers.get('X-Tinglan-Subject');
    if (subject) {
      try { await reserveUser(this.storage, subject, this.env); }
      catch (error) { return failure(error.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', error.message === 'RATE_LIMITED' ? 429 : 503); }
    }
    return super.handle(request);
  }
}
export default createGateway(core);
