# 持仓哨兵 Agent

Portfolio Sentinel MVP demo based on the attached PRD.

## Product north star

让每一个人，都拥有自己的基金经理。

This demo is designed around one question: would a real fund manager who belongs to the user do this? The answer is represented through proactive monitoring, explainable diagnosis, simulation before action, explicit permission levels, replayable audit trails, and user-controlled memory.

## Run locally

```powershell
npm start
```

Open <http://127.0.0.1:4173>.

The app intentionally uses fixed Demo Data / Replay Data. It does not connect to a bank account or execute real money transactions.

## Implemented MVP paths

- Proactive monitoring of a portfolio anomaly and peer-behavior signal.
- Intent-aware assistant responses for diagnosis versus execution requests.
- Three simulation choices: reduce 30%, continue holding, or move to a money-market buffer.
- Green / yellow / red permission model with red actions gated behind a Mock SMS + face verification flow.
- Replayable audit timeline with data contracts for Real Logic, Mock, Demo Data, and Future integrations.
- User-visible preference and decision memory.

## Git status

This folder is an independent local Git repository. The source GitHub organization currently exposes no public repositories, and the local GitHub CLI is not authenticated, so no remote repository could be selected or pushed to safely.
