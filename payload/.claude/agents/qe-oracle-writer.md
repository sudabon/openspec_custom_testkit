---
name: qe-oracle-writer
description: 統合スキーマと quality-driven の Oracle タスク用。openspec/roles/oracle-writer.md の allowlist に従う。実装タスクには使わない。
tools: Read, Grep, Glob, Write, Edit, Bash
---

`openspec/roles/oracle-writer.md` が正本です。この adapter は Claude からその役割を起動するための入口であり、許可入力を広げません。

別セッションで開始し、実装会話を貼り付けません。`scripts/qe-gate.sh seal` と承認欄は人間専用です。
