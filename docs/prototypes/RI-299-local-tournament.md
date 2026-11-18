# RI-299: ローカル大会の読み取り専用比較API

対象: #695 / 親 #548。判定: **再試作**。既存JSONを2〜4件比較するAPIの契約は確認できた。取込UI・条件不明の理解しやすさ・人間のプレイ評価は未実施で、Issueはopenを維持する。試作PRのマージは本番採用を意味しない。

## 検証した判断と境界

プレイヤー価値の仮説は、同じ条件の記録を持ち寄り、出荷を伸ばした運営と早く消耗した運営を振り返れること。出荷と継続の代償を単一順位へ隠さず、まず条件の一致と記録結果を並べられるかを検証した。通常ランの固定トラック・自動WinType・課金・報酬・ルールは変更しない。

`src/prototypes/localTournament.ts` の `compareLocalTournament(inputs)` は各要素の `json` を実際の `parseReplayShare` に渡す純粋なバッチAPI。結果は `source: recorded-replay-json`、`authenticity: unverified-local-records`、`ranking: none`。`participantNote` は任意のローカル注記であり、本人性、改変防止、実プレイの真正性を保証しない。parserは閲覧可能性を確認するだけで、入力列からのリプレイ再実行やチート検出は行わない。

出荷は最後の終端フレームの `totals.delivered`、`recordedWinType` は記録された `outcome.winType`（敗北等の欠落は `null`）。終端とoutcomeの出荷・診断・WinType・敗因に矛盾があれば `issues` を付けて比較不能にする。記録値を自動再判定した勝利種別へ書き換えない。今回は順位を持たないため指標を変更する設定もない。順位の導入は、取込前に固定する指標と同点規則を設計する別作業とする。

## 条件照合

`pastRunCompare.checkIdentity` を変更せず読み取り再利用し、seed・難易度・試練・シナリオ・ラン種別・ruleset・解放プール・研修方針の8項目をペアごとに返す。追加の `recordedStart` は、スプリント0のsetupフレーム全体のキー順正規化による保守的な一致。予算・組織・初期資源・プール・daily日付・baseConfig等の差も別組にする。開始時setupが1枚でない場合は比較不能。後のsetupでは代用しない。記録された初期条件の一致であり、記録されなかった制約や外部の挑戦コード条件まで一致したという保証ではない。

既存比較の研修方針欠落→空配列という互換補完は、この試作の参加判定に使わない。エントリ単位の `issues`（`missing` / `unknown` / `inconsistent`）を追加し、欠落した研修方針、シナリオ、本体とextrasのシナリオ矛盾、ラン種別、daily日付、未知の試練/プールID等を明示する。`pairs.identity` は既存照合の結果、最終的な参加可否は `entries.issues` と `pairs.status` を読む。旧照合が `match` を返しても欠落のある組は `incomparable` になる。parserが補完する目標持越し条件も、元JSONの本体/extrasの両方で欠けていればmissing、両方に記録され値が矛盾すればinconsistentにする。正規化前の四半期とIDの組についても、片方のみ/片方だけnullをinconsistent、未知IDや不正な四半期をunknownとする。診断を重複キーに含め、補完後に同内容へ潰れて欠落が隠れないようにする。

本試作が内容を解釈できるrulesetは `CURRENT_RUN_RULESET` のみ。旧v1のruleset欠損は `missing`、異なる記録済みrulesetは（同じ旧fingerprint同士でも）`unknown` として比較不能にする。将来の履歴ruleset対応には既知版の検証根拠が必要で、現行へ補完しない。難易度や版等をparserが拒否する場合は `imports` に理由を残す。

条件既知で全項目一致の記録だけを同じ `groups` に入れる。既知の条件不一致は `different-conditions` で別組、欠落・未知・矛盾は `incomparable` でgroupへ入れない。比較不能な記録も読める結果と理由は残す。出荷だけで条件の不一致を無視して比較しない。

## 再取込・衝突・上限

APIは追記可能な大会オブジェクトを持たず、毎回現在の2〜4ファイルを渡し直す。同じ入力で何回呼んでも同じ結果で、参加数や報酬は蓄積しない。欠損・旧形式・読込失敗でも通常meta/daily/save/replay/storageへの書込みはない。返り値・元入力・呼出元の既存比較・既存RunEngineも変更しない。

重複キーは条件欠落/未知/矛盾の診断とparserの正規化後の内容全体を安定したキー順で直列化した文字列そのもの。ハッシュ衝突はない。トップレベルの `id` / `finishedAt`、各キーフレームの表示 `label`、任意注記は除外する。空白、JSONキー順、書出しに伴うID/時刻/表示ラベル差で増殖しない。`exportedAt` も書出時刻として除外する。それ以外の未知のトップレベルフィールドは内容キーに保持し、`unrecognizedFields: unknown` として比較不能にする。内容スナップショットやフレームの変更は別内容として扱うため、異なる記録を同一プレイとして認証するものではない。

同内容の再取込は `duplicate` と元の入力indexを返し、最初の注記を保持する。別IDの同内容も重複。ただし全IDを予約し、同IDで異内容が来た場合は `id_collision` でバッチ全体を拒否する。後勝ち上書きや自動改名はしない。呼出側は前の比較を保持できる。単独ファイルの破損等は `rejected` とし、残りの読める記録を返す。重複・拒否後に2件未満なら `enoughParticipants: false`。

試作独自の上限は入力2〜4件、1件2,000,000 UTF-16文字、キーフレーム256、注記80文字、文字列/キー16,000文字、配列5,000要素、深さ48、探索250,000ノード/ファイル。parser/hydrate前に仕事量を制限する。配列上限はタスク・履歴・入力に相当する埋込配列にも適用する。保存や大会履歴自体は生成しない。上限超過で元記録の切捨てや保存は行わない。

## 実RunEngineによる再現

再現コマンド:

```sh
devcontainer exec --workspace-folder . node scripts/ri299-local-tournament-evaluation.mjs
```

今回の環境では標準configのGH CLI feature取得がGHCR接続タイムアウトしたため、同一 `mcr.microsoft.com/devcontainers/typescript-node:24-bookworm` でfeatureのみを省いた `/private/tmp/devops-tycoon-issue-695-container/devcontainer.json` を使用した。リポジトリ設定は変更していない。実行時は `--workspace-folder .` の後に `--config /private/tmp/devops-tycoon-issue-695-container/devcontainer.json` を加えた。Node v24.16.0。

`tests/unit/helpers/localTournamentFixture.ts` は公開RunEngineと既存 `runFlow.advance` のplain / skilled固定方針で完走する。難易度normal、試練なし、default、同seedの同じ初期予算45・同じ初期組織/資源。plainは手札を可能な限り使用して進行、skilledは同じ方針にペアレビュー・滞留時の割込み・延焼前の火消しを加える。ドラフト等の選択は同ヘルパに固定し、追加の費用免除はない。施策/介入費用と消耗は実ルールのまま。全初期資源・baseConfig・ruleset・プール・終端成果/費用の記録値はJSONに保存した。入力は固定方針のソース・seed・skilled指定で再現する。入力ログ再生や途中RNG再開を新設した試作ではない。

保存資料:

- `local-tournament-replays.json`: 4件の実記録。開始setupと終端だけを保持した既存ReplayBlob。架空の履歴・因果・WinTypeを追加していない。
- `local-tournament-comparison.json`: 実parserを経由した比較結果。g1/g2を別組にし、各組にplain/skilledを含む。

| seed | 方針 | 累計出荷 | 記録上WinType | 結果・代償 |
| --- | --- | ---: | --- | --- |
| g1 | plain | 5990 | null | lost / seniorBurnout |
| g1 | skilled | 6189 | null | lost / seniorBurnout |
| g2 | plain | 13431 | null | lost / budgetExhausted |
| g2 | skilled | 3051 | null | lost / seniorBurnout |

2 seedで方針一要因を変えると出荷の大小が逆転する。この4件は条件照合と記録表示の材料であり、方針の一般的な強さ、楽しさ、人間の適応行動の証明ではない。全件敗北なので勝利例のWinTypeは捏造せずnullで残した。

## 判定と次の終了条件

**再試作**。API上は2〜4記録の同条件/別組/不明を分離でき、重複増殖と保存副作用を避けられた。人間には取込UIで「比較不能」と「別組」の違い、注記と本人性の違い、出荷と勝利種別の読み分けが伝わるか未確認。

次は独立した取込UI試作で2〜4人相当の記録を使い、人間が条件不明を一致と誤認せず、再取込・衝突から復帰できることを終了条件にする。通常UIへの統合や認証/ランキングはその後に判断する。現時点でIssue完了とはしない。

## 検証範囲

対象unitは実記録2〜4件の実parser、同seed再記録の決定論、条件一要因の差、旧形式/欠損/未知、終端矛盾、重複/ID衝突、入力上限を検証する。既存ランのスプリント中RNG位置付き `exportCounterfactualFrame` を比較前後で照合し、localStorage/IndexedDBアクセスも監視する。比較APIは状態遷移/乱数/課金/報酬を持たず、再開始・完了後操作・再集計による二重消費は発生しない。通常のRNG位置付き保存形式は変更しない。

UI/Pixi変更なし。ローカルのE2E/gallery/全体coverageは対象外とし、必須CIの全体ジョブで確認する。
