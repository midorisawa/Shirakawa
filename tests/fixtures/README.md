# X DOM fixture

`x-page.html`は、2026-09-20にログイン済みX日本語UIで観測した投稿構造を、架空データで最小再現するテスト用ページです。`tests/fixture.test.mjs`の先頭テストがこのHTMLをjsdomに読み込み、content scriptの原文復元と再判定を検証します。`filter-preview.html`と`options-preview/popup-check.html`は手動プレビュー用です。

共通の投稿セレクターは`main [data-testid="primaryColumn"]`、`article[role="article"][data-testid="tweet"]`、本文の`div[data-testid="tweetText"]`、投稿者の`div[data-testid="User-Name"]`、投稿時刻の`time`です。引用カードは投稿記事内の`div[role="link"]`に同じ本文・投稿者要素を持ちます。

実Xでは本文の`tweetText`と引用カード内の`tweetText`で祖先の深さが異なったため、fixtureも固定のラッパー数ではなくセレクターと`role="link"`による包含関係を前提にします。

「投稿を追加」は新しい`cellInnerDiv`と`article`を追加し、「先頭投稿を差し替え」は同じ`article`要素のID、投稿者、時刻、本文を変更するテスト用の人工シナリオです。実Xでの動的追加・差し替えのDOM再利用挙動は観測していません。人工操作用のボタンは`primaryColumn`外にあり、投稿セレクターには一致しません。

画像・動画・リンク先の内容は含めません。個人名、実投稿、実リストIDは保存していません。
