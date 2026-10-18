import core, { ReviewService as CoreReviewService } from '../../../chenchen/deployment/worker.js';
import { createGateway, reserveUser, failure } from './gateway.mjs';

// Keep the same Durable Object class name and existing migration history.
export class ReviewService extends CoreReviewService {
  async handle(request) {
    const subject = request.headers.get('X-Tinglan-Subject');
    if (subject) {
      try { await reserveUser(this.storage, subject, this.env); }
      catch (error) { return failure(error.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', error.message === 'RATE_LIMITED' ? 429 : 503); }
    }
    return super.handle(request);
  }
}
export default createGateway(core);
