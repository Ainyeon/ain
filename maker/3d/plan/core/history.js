// 실행 취소 스택 — Store 가 {label, before, after}(문서 참조) 항목을 쌓는다. 한도를 넘으면 가장 오래된 것부터 버린다
export class History {
  constructor(limit = 200) { this.limit = limit; this.clear(); }
  clear() { this.stack = []; this.pos = 0; this.base = {}; } // base = '처음 상태' 표식(저장 여부 비교용)
  push(cmd) {
    this.stack.length = this.pos; // 되돌린 뒤 새 작업이면 다시 실행 꼬리는 버린다
    this.stack.push(cmd);
    if (this.stack.length > this.limit) { this.stack.shift(); this.base = {}; } // 처음 상태로는 더 못 돌아간다
    this.pos = this.stack.length;
  }
  get top() { return this.pos ? this.stack[this.pos - 1] : this.base; } // 지금 상태를 가리키는 표식
  get canUndo() { return this.pos > 0; }
  get canRedo() { return this.pos < this.stack.length; }
  undo() { return this.pos ? this.stack[--this.pos] : null; } // 되돌린 항목
  redo() { return this.pos < this.stack.length ? this.stack[this.pos++] : null; }
}
