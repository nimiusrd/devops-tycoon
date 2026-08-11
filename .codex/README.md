# CodexのDocker設定

このプロジェクトの `.codex/config.toml` は、ユーザー設定に定義した
`workspace-docker` プロファイルをこのプロジェクトでのみ選択します。

Codexでこのリポジトリを開く前に、次の準備を行ってください。

1. `.codex/config.toml.example` の内容を `~/.codex/config.toml` へ統合する。既存のユーザー設定は置き換えず、TOMLの設定をマージする。
2. Codexからプロジェクトの信頼を求められた場合、このリポジトリを信頼する。
3. Codexを再起動して新しいタスクを開始する。
4. 新しいタスクで `docker ps` を実行してDocker接続を確認する。

テンプレートの `default_permissions = ":workspace"` は、他のプロジェクトへ
Docker権限を広げないための安全な既定値です。
