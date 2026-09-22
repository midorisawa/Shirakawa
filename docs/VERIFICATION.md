# 公開物検証手順

この手順では、ウェブストアからインストールした拡張機能やGitHub Releasesで配布されているZIPファイルの内容が、対応するGitタグのソースコードから再ビルドした`dist`フォルダーの内容と一致することを確認できます。

## ソースからの再ビルド

GitHub Actionsのビルド環境と同じNode.js 24.19.0およびpnpm 11.19.0を使用し、改行コードの自動変換を無効にした状態で該当タグのソースコードを取得します。利用するシェルのブロックで対象バージョンを指定してください。

```sh
VERSION=0.1.1
git -c core.autocrlf=false clone --branch "v$VERSION" --depth 1 https://github.com/midorisawa/Shirakawa.git shirakawa-source
```

PowerShell環境（Windows）では以下を実行します。

```powershell
$version = '0.1.1'
git -c core.autocrlf=false clone --branch "v$version" --depth 1 https://github.com/midorisawa/Shirakawa.git shirakawa-source
```

以降はPOSIX環境とPowerShell環境で共通です。

```sh
cd shirakawa-source
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ..
```

`pnpm --version`と`node --version`を実行し、それぞれのバージョンが指定されたものと一致していることを確認してください。なお、Windows環境で`core.autocrlf=true`によるCRLF変換が行われるとハッシュ値（比較結果）に差分が生じるため、既存のチェックアウト済みリポジトリは使用せず、新規にクローンしてください。

## 展開後の比較

配布されているZIPファイルを展開したフォルダーまたは拡張機能の格納先フォルダー（`release-dist`とする）と、ローカルで再ビルドした`shirakawa-source/dist`で、相対パスごとのファイル構成およびSHA-256ハッシュ値を比較します。

POSIX環境（Linux/macOS）では以下を実行します。

```sh
diff -qr release-dist shirakawa-source/dist
```

PowerShell環境（Windows）では以下を実行します。

```powershell
Expand-Archive ".\shirakawa-$version.zip" -DestinationPath .\release-dist
$releaseRoot = (Resolve-Path .\release-dist).Path
$buildRoot = (Resolve-Path .\shirakawa-source\dist).Path
$releaseFiles = Get-ChildItem $releaseRoot -File -Force -Recurse | ForEach-Object { $_.FullName.Substring($releaseRoot.Length + 1) } | Sort-Object
$buildFiles = Get-ChildItem $buildRoot -File -Force -Recurse | ForEach-Object { $_.FullName.Substring($buildRoot.Length + 1) } | Sort-Object
if (Compare-Object $releaseFiles $buildFiles) { throw 'File set mismatch' }
foreach ($path in $releaseFiles) {
  if ((Get-FileHash (Join-Path $releaseRoot $path)).Hash -ne (Get-FileHash (Join-Path $buildRoot $path)).Hash) { throw "File content mismatch: $path" }
}
```
