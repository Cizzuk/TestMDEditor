const editor = document.getElementById('editor');
let history = [{content: '', caretPos: 0}];
let redoStack = [];
let isComposing = false;

// 初期化
window.onload = function() {
  // sessionStorageからデータを取得
  const savedContent = sessionStorage.getItem('rawContent');
  const savedHistory = sessionStorage.getItem('history');
  const savedRedoStack = sessionStorage.getItem('redoStack');
  if (savedHistory) {
    history = JSON.parse(savedHistory);
  }
  if (savedRedoStack) {
    redoStack = JSON.parse(savedRedoStack);
  }
  if (savedContent) {
    rawContent.set(savedContent, savedContent.length - 1);
  } else {
    rawContent.set('# ', 2);
  }
  // スクロール位置を先頭に
  editor.scrollTop = 0;
};

const rawContent = new function() {
	let raw = '';
	this.get = function() {
		return raw;
	  };
	  this.set = function(content, caretPos = getCaretOffset(), noHistory = false) {
    if (!content.endsWith('\n')) {
      content += '\n';
    }
	  	raw = content;
    sessionStorage.setItem('rawContent', raw);
	  	render();
    setCaretOffset(caretPos);
    if (!noHistory) {
      pushHistory(content, caretPos);
    }
	};
}

// HTML特殊文字をエスケープ
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

// キャレット位置を文字オフセットで取得
function getCaretOffset() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

// オフセットからカーソル復元
function setCaretOffset(offset) {
  let charCount = 0;
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  const stack = [editor];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === Node.TEXT_NODE) {
      const next = charCount + node.length;
      if (offset <= next) {
        range.setStart(node, offset - charCount);
        range.collapse(true);
        break;
      }
      charCount = next;
    } else {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        stack.push(node.childNodes[i]);
      }
    }
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  // スクロール位置を調整
  const rect = range.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  if (rect.top < editorRect.top) {
    editor.scrollTop -= (editorRect.top - rect.top);
  } else if (rect.bottom > editorRect.bottom) {
    editor.scrollTop += (rect.bottom - editorRect.bottom);
  }
}

// 履歴に保存
function pushHistory(content = rawContent.get(), caretPos = getCaretOffset()) {
  // 直前の履歴と同じなら無視
  if (history.length > 0 && history[history.length - 1].content === content) {
    return;
  }
  history.push({content, caretPos});
  if (history.length > 100) history.shift();
  sessionStorage.setItem('history', JSON.stringify(history));
  redoStack = [];
  sessionStorage.setItem('redoStack', JSON.stringify(redoStack));
}

// Undo
function undo() {
  if (history.length < 2) return;
  redoStack.push(history.pop());
  const last = history[history.length - 1];
  rawContent.set(last.content, last.caretPos, true);
  sessionStorage.setItem('history', JSON.stringify(history));
  sessionStorage.setItem('redoStack', JSON.stringify(redoStack));
}
// Redo
function redo() {
  if (redoStack.length === 0) return;
  const last = redoStack.pop();
  history.push(last);
  rawContent.set(last.content, last.caretPos, true);
  sessionStorage.setItem('history', JSON.stringify(history));
  sessionStorage.setItem('redoStack', JSON.stringify(redoStack));
}

// 保存 (Shift+S)
function saveFile() {
  const content = rawContent.get().slice(0, -1);
  const blob = new Blob([content], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Document.md';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  document.body.removeChild(a);
}

// Enter時の自動インデント
function handleEnterIndent(isShift) {
  const caretPos = getCaretOffset();
  const sel = window.getSelection();
  if (!sel.rangeCount || isShift) {
    rawContent.set(rawContent.get().slice(0, caretPos) + '\n' + rawContent.get().slice(caretPos), caretPos + 1);
    return;
  }
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const textBefore = pre.toString();
  const lastLineMatch = textBefore.match(/(^|\n)([^\n]*)$/);
  const line = lastLineMatch ? lastLineMatch[2] : '';
  let indent = '', newMarker = '';

  const mOl = line.match(/^(\s*)(\d+)\.\s+/);
  const mList = line.match(/^(\s*)([>\-\*\+])\s+/);
  if (mOl) {
    // 番号付きリスト
    indent = mOl[1];
    const num = parseInt(mOl[2], 10) + 1;
    newMarker = `${num}. `;
  } else if (mList) {
    // 箇条書き or 引用
    indent = mList[1];
    newMarker = mList[2] + ' ';
  }

  const noIndentContent = rawContent.get().slice(0, caretPos) + '\n' + rawContent.get().slice(caretPos);
  pushHistory(noIndentContent, caretPos + 1);

  const content = rawContent.get().slice(0, caretPos) + '\n' + indent + newMarker + rawContent.get().slice(caretPos);
  rawContent.set(content, caretPos + indent.length + newMarker.length + 1);
}

// Markdown→HTML変換＆プレビュー
function render() {
  function decorateInline(text) {
    text = escapeHtml(text);
    return text
      // 太字, リンク, 画像, コード
      .replace(/(^|[^\\])\*\*(.+?)\*\*/g, '$1<span class="bold">**$2**</span>')
      .replace(/(^|[^\\])__(.+?)__/g, '$1<span class="bold">__$2__</span>')
      .replace(/(^|[^\\])\*(.+?)\*/g, '$1<span class="bold">*$2*</span>')
      .replace(/(^|[^\\])_(.+?)_/g, '$1<span class="bold">_$2_</span>')
      .replace(/(^|[^\\])\`\`(.+?)\`\`/g, '$1<span class="inline-code">``$2``</span>')
      .replace(/(^|[^\\])\`(.+?)\`/g, '$1<span class="inline-code">`$2`</span>')
      .replace(/(^|[^\\])\!\[(.+?)\]\((.+?)\)/g, '$1<a class="link" href="$3">![$2]($3)</a><img class="image" src="$3" alt="">')
      .replace(/(^|[^\\])\[(.+?)\]\((.+?)\)/g, '$1<a class="link" href="$3">[$2]($3)</a>')
      
  }

  let content = rawContent.get();

  const lines = content.split('\n');
  let inCodeBlock = false;
  let inQuote = false;
  const html = lines.map(line => {
    // コードブロック
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        return `<span class="code-block"><span class="out">${decorateInline(line)}</span>`;
      } else {
        inCodeBlock = false;
        return `<span class="out">${decorateInline(line)}</span></span>`;
      }
    }
    // 見出し
    const mH = line.match(/^(#{1,6})+(.*)$/);
    if (mH) {
      const level = mH[1].length;
      return `<h${level}><span class="out">${mH[1]}</span>` +
             `<span class="in">${decorateInline(mH[2])}</span></h${level}>`;
    }
    // 引用
    const mBq = line.match(/^>\s+(.*)$/);
    if (mBq) {
      inQuote = true;
      return `<span class="blockquote out">&gt; </span>` +
             `<span class="blockquote in">${decorateInline(mBq[1])}</span>`;
    }
    // 空行でなければ引用継続
    if (inQuote) {
      if (line === '') {
        inQuote = false;
      }
      return `<span class="blockquote in">${decorateInline(line)}</span>`;
    } 
    // 箇条書き
    const mUl = line.match(/^(\s*)([>\-\*\+])\s+(.*)$/);
    if (mUl) {
      return `<span class="ul out">${mUl[1]}${mUl[2]} </span>` +
             `<span class="ul in" role="listitem">${decorateInline(mUl[3])}</span>`;
    }
    // 番号付きリスト
    const mOl2 = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (mOl2) {
      return `<span class="ol out">${mOl2[1]}${mOl2[2]}. </span>` +
             `<span class="ol in" role="listitem">${decorateInline(mOl2[3])}</span>`;
    }
    // セパレーター
    const mHr = line.match(/^-{3,}$/);
    if (mHr) {
      return `<span class="hr out">${decorateInline(line)}</span>`;
    }
    // 通常行
    return `<span>${decorateInline(line)}</span>`;
  })
  .join('\n');

  editor.innerHTML = html;
}

// 選択範囲のカーソルの位置(数値)を取得, 選択範囲がない場合はどちらも現在のカーソル位置を返す
function getSelectionPoint() {
  const sel = window.getSelection();
  const caretPos = getCaretOffset();
  if (!sel.rangeCount) return [caretPos, caretPos];
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return [start, end];
}

// イベント登録
editor.addEventListener('compositionstart', () => {
  isComposing = true;
});
editor.addEventListener('compositionend', () => {
  isComposing = false;
  rawContent.set(editor.innerText);
});
editor.addEventListener('input', e => {
  if (isComposing) return;
  rawContent.set(editor.innerText);
});
// ペーストhandler
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  const url = e.clipboardData.getData('text/uri-list');
  const [start, end] = getSelectionPoint();
  const content = rawContent.get();
  if (url) {
    const noAutoLinkContent = content.slice(0, start) + text + content.slice(end);
    pushHistory(noAutoLinkContent, start + text.length);
    const newContent = content.slice(0, start) + `[${content.slice(start, end)}](${url})` + content.slice(end);
    rawContent.set(newContent, start + 1 + content.slice(start, end).length);
  } else {
    const newContent = content.slice(0, start) + text + content.slice(end);
    rawContent.set(newContent, start + text.length);
  }
});
editor.addEventListener('keydown', e => {
  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  // Undo (Cmd/Ctrl+Z)
  if (ctrl && !e.shiftKey && key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  // Redo (Cmd/Ctrl+Y or Cmd/Ctrl+Shift+Z)
  if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
    e.preventDefault();
    redo();
    return;
  }
  // Save (Cmd/Ctrl+S)
  if (ctrl && key === 's') {
    e.preventDefault();
    saveFile();
    return;
  }
  // Enter → 自動インデント (IME中除く)
  if (key === 'Enter' && e.keyCode !== 229) {
    e.preventDefault();
    handleEnterIndent(e.shiftKey);
    return;
  }
  // Tab → インデント
  if (key === 'Tab') {
    e.preventDefault();
    const [start, end] = getSelectionPoint();
    const content = rawContent.get();
    const newContent = content.slice(0, start) + '  ' + content.slice(end);
    rawContent.set(newContent, start + 2);
    return;
  }
  // Bold (Cmd/Ctrl+B)
  if (ctrl && key === 'b') {
    e.preventDefault();
    const [start, end] = getSelectionPoint();
    const content = rawContent.get();
    const newContent = content.slice(0, start) + '**' + content.slice(start, end) + '**' + content.slice(end);
    rawContent.set(newContent, end + 2);
    return;
  }
});