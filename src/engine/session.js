// 一局游戏：玩家盘面状态、撤销/重做历史、计时与统计。与具体游戏和 UI 无关。
//
// 各游戏的规则模块（games/<id>/index.js）需提供：
//   generate(params)            → puzzle（含 game/width/height/difficulty/seed 与答案）
//   initialState(puzzle)        → 空白盘面状态（可 JSON 序列化的普通对象）
//   isSolved(puzzle, state)     → 是否完成
//   findWrong(puzzle, state)    → 与答案矛盾的条目列表（由该游戏的 view 负责标红）
//   hint(puzzle, state)         → { state, message? } 或 null：按推理顺序放上一步正确内容
//   solvedState(puzzle)         → 答案对应的盘面状态
//   progress?(puzzle, state)    → 状态栏显示的进度文字
// 状态一律不可变：任何修改都返回新对象。

const MAX_HISTORY = 500;

const copy = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Session {
  constructor(rules, puzzle, saved = null) {
    this.rules = rules;
    this.puzzle = puzzle;
    this.state = rules.initialState(puzzle);
    this.undoStack = [];
    this.redoStack = [];
    this.moves = 0;
    this.hintsUsed = 0;
    this.revealed = false;
    this.elapsedMs = 0;
    if (saved) {
      if (saved.state) this.state = saved.state;
      this.undoStack = saved.undoStack || [];
      this.redoStack = saved.redoStack || [];
      this.moves = saved.moves || 0;
      this.hintsUsed = saved.hintsUsed || 0;
      this.revealed = !!saved.revealed;
      this.elapsedMs = saved.elapsedMs || 0;
    }
    this.solved = rules.isSolved(puzzle, this.state);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** 提交新状态（无变化则忽略）。返回是否有变化。 */
  apply(next) {
    if (!next || same(next, this.state)) return false;
    this.undoStack.push(this.state);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.state = copy(next);
    this.moves++;
    this.refresh();
    return true;
  }

  undo() {
    if (!this.canUndo) return false;
    this.redoStack.push(this.state);
    this.state = this.undoStack.pop();
    this.refresh();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.undoStack.push(this.state);
    this.state = this.redoStack.pop();
    this.refresh();
    return true;
  }

  /** 清空盘面（可撤销）。 */
  reset() {
    return this.apply(this.rules.initialState(this.puzzle));
  }

  hint() {
    const res = this.rules.hint(this.puzzle, this.state);
    if (!res || !this.apply(res.state)) return null;
    this.hintsUsed++;
    return res;
  }

  reveal() {
    this.apply(this.rules.solvedState(this.puzzle));
    this.revealed = true;
  }

  findWrong() {
    return this.rules.findWrong(this.puzzle, this.state);
  }

  progress() {
    return this.rules.progress ? this.rules.progress(this.puzzle, this.state) : '';
  }

  refresh() {
    this.solved = this.rules.isSolved(this.puzzle, this.state);
  }

  toJSON() {
    return {
      state: this.state,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      moves: this.moves,
      hintsUsed: this.hintsUsed,
      revealed: this.revealed,
      elapsedMs: this.elapsedMs,
    };
  }
}
