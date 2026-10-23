'use strict';
const fs = require('node:fs');
const { createReviewService } = require('./vendor/provider/local-review.js');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const started = Date.now();
const service = createReviewService();
service.run({ kind: 'combined', text: input.text, source: 'finance-conversation-local',
  data_mode: input.synthetic ? 'SYNTHETIC_REPLAY' : 'LIVE', execution_mode: 'PAPER', capability: 'REVIEW_ONLY', allow_rule_fallback: false,
  requested_action: '根据用户明确问题与其自述收支进行中文教育性分析，先说明判断，再给核对步骤，资料不足时追问。金额计算以输入内确定性汇总为准。不推断风险偏好，不编造资产、市场数据或收益，不推荐个股，不执行交易。' })
  .then(result => {
    const body = result.body;
    const model = body.model_response;
    const proposal = model?.proposal;
    if (result.status === 200 && (body.source !== 'model' || !model?.call_succeeded || model.model !== process.env.MODEL_NAME || !proposal?.action_reason)) {
      throw new Error('Invalid provider evidence');
    }
    const evidence = { timestamp: new Date().toISOString(), http_status: result.status, duration_ms: Date.now() - started,
      run_id: body.run_id, source: body.source, model: model?.model, call_succeeded: model?.call_succeeded === true,
      provider_response_id: model?.provider_response_id, usage: model?.usage, raw_text: model?.raw_text,
      proposal, error: body.error, execution_allowed: false, attempts: 1 };
    process.stdout.write(JSON.stringify({ ...result, evidence }));
  }).catch(() => { process.stdout.write(JSON.stringify({ status: 502, body: { error: { code: 'LOCAL_PROVIDER_FAILED', message: '模型调用失败，本次没有生成分析结论。' } } })); });
