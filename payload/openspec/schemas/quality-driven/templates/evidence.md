# Evidence

<!-- Greenは「定義された評価基準を満たした」という結果にすぎない。ここではそのGreenが何を保証し、何を保証しないかを記録する -->

## Checks

| チェック | コマンド | 結果 | 実施コンテキスト |
|----------|----------|------|------------------|
| Oracle tests | | pass N/N | 実装 |
| Falsification | | 反例 N件 → 修正 M / Residual K | qe-falsifier(別コンテキスト) |
| Mutation Testing(high のみ) | | score xx%(閾値 yy%) | CI |

## Risk → Evidence

<!-- quality.md の全 Risk ID を網羅する -->

| Risk | Failure Mode | Oracle | テスト (Layer) | 結果 |
|------|--------------|--------|----------------|------|
| R1   | F1           | O1     |                |      |

## Falsification Findings

<!-- 反証で見つかった反例と、その扱い(修正 / Residual として承認) -->

-

## Residual Risk

<!-- quality.md から引き継いだもの + 実装中に判明したもの -->

-

## Oracle Changes

<!-- seal 後に Oracle を変更した場合のみ: 変更内容・理由・承認者 -->

- なし
