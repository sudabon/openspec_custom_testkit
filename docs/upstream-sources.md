# 出典

統合 kit は次の版を読み取り専用で取り込み、このリポジトリの `upstream/baselines/` に payload のコピーを置いている。旧 checkout は変更しない。

| 出典 | 採用 SHA | パッケージ版 | ライセンス |
|------|----------|--------------|------------|
| [openspec_quality_kit](https://github.com/sudabon/openspec_quality_kit) | `e537d10da53112fce684f31d1602c1e061ab87a2` | 0.1.2 | MIT, Copyright (c) 2026 sudabon |
| [openspec_e2e_test](https://github.com/sudabon/openspec_e2e_test) | `53e354fa366f02cf412e9ce93419463a37e8255c` | 0.2.0 | MIT, Copyright (c) 2026 sudabon |
| OpenSpec CLI の fork 基準 | 1.13.1 | - | 利用者環境の OpenSpec |

ファイルごとの sha256 は `upstream/manifest.json` が正本である。`npm run manifest` は baseline の実バイトからこのファイルを再生成する。

ローカルの E2E checkout `7abd8bf9c73cce97a3afeb9b989d37c5a7486494` は採用していない。
