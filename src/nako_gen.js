//
// nako_gen.js
//
'use strict'

class NakoGenError extends Error {
  constructor (msg, line) {
    if (line) {
      msg = '[文法エラー](' + line + ') ' + msg
    } else {
      msg = '[文法エラー] ' + msg
    }
    super(msg)
  }
}

/**
 * 構文木からJSのコードを生成するクラス
 */
class NakoGen {
  /**
   * @ param com {NakoCompiler} コンパイラのインスタンス
   */
  constructor (com) {
    this.header = this.getHeader()

    /**
     * プラグインで定義された関数の一覧
     * @type {{}}
     */
    this.plugins = {}

    /**
     * 利用可能なプラグイン(ファイル 単位)
     * @type {{}}
     */
    this.pluginfiles = {}

    /**
     * なでしこで定義した関数の一覧
     * @type {{}}
     */
    this.nako_func = {}

    /**
     * JS関数でなでしこ内で利用された関数
     * 利用した関数を個別にJSで定義する
     * (全関数をインクルードしなくても良いように)
     * @type {{}}
     */
    this.used_func = {}

    /**
     * ループ時の一時変数が被らないようにIDで管理
     * @type {number}
     */
    this.loop_id = 1

    /**
     * 変換中の処理が、ループの中かどうかを判定する
     * @type {boolean}
     */
    this.flagLoop = false

    /**
     * それ
     */
    this.sore = this.varname('それ')

    /**
     * なでしこのローカル変数をスタックで管理
     * __varslist[0] プラグイン領域
     * __varslist[1] なでしこグローバル領域
     * __varslist[2] 最初のローカル変数 ( == __vars }
     * @type {[*]}
     * @private
     */
    this.__varslist = [{}, {}, {}]

    this.__self = com

    /**
     * なでしこのローカル変数(フレームトップ)
     * @type {*}
     * @private
     */
    this.__vars = this.__varslist[2]
  }

  reset () {
    this.nako_func = {}
    this.used_func = {}
    this.loop_id = 1
    this.__varslist[1] = {}
    this.__vars = this.__varslist[2] = {}
  }

  getHeader () {
    return '' +
      'var __varslist = this.__varslist = [{}, {}, {}];\n' +
      'var __vars = this.__varslist[2];\n' +
      'var __self = this;\n'
  }

  /**
   * プログラムの実行に必要な関数を書き出す(システム領域)
   * @returns {string}
   */
  getVarsCode () {
    let code = ''
    // プログラム中で使った関数を列挙して書き出す
    for (const key in this.used_func) {
      const f = this.__varslist[0][key]
      const name = `this.__varslist[0]["${key}"]`
      if (typeof (f) === 'function') {
        code += name + '=' + f.toString() + ';\n'
      } else {
        code += name + '=' + JSON.stringify(f) + ';\n'
      }
    }
    return code
  }

  /**
   * プログラムの実行に必要な関数定義を書き出す(グローバル領域)
   * @returns {string}
   */
  getDefFuncCode () {
    let code = ''
    // なでしこの関数定義を行う
    let nakoFuncCode = ''
    for (const key in this.nako_func) {
      const f = this.nako_func[key].fn
      nakoFuncCode += `this.__varslist[1]["${key}"]=${f};\n`
    }
    if (nakoFuncCode !== '') {
      code += '__varslist[0].line=0;// なでしこの関数定義\n' + nakoFuncCode
    }
    // プラグインの初期化関数を実行する
    let pluginCode = ''
    for (const name in this.pluginfiles) {
      const initkey = `!${name}:初期化`
      if (this.used_func[initkey]) {
        // セミコロンがないとエラーになったので注意
        pluginCode += `__varslist[0]["!${name}:初期化"](__self);\n`
      }
    }
    if (pluginCode !== '') {
      code += '__varslist[0].line=0;// プラグインの初期化\n' + pluginCode
    }
    // それを初期化
    code += '__vars["それ"] = \'\';\n'
    return code
  }

  getVarsList () {
    return this.__varslist
  }

  /**
   * プラグイン・オブジェクトを追加
   * @param po プラグイン・オブジェクト
   */
  addPlugin (po) {
    // 変数のメタ情報を確認
    if (this.__varslist[0].meta === undefined) {
      this.__varslist[0].meta = {}
    }
    // プラグインの値をオブジェクトにコピー
    for (let key in po) {
      const v = po[key]
      this.plugins[key] = v
      if (v.type === 'func') {
        this.__varslist[0][key] = v.fn
      } else if (v.type === 'const' || v.type === 'var') {
        this.__varslist[0][key] = v.value
        this.__varslist[0].meta[key] = {
          readonly: (v.type === 'const')
        }
      } else {
        throw new NakoGenError('プラグインの追加でエラー。', null)
      }
    }
  }

  /**
   * プラグイン・オブジェクトを追加(ブラウザ向け)
   * @param objName オブジェクト名
   * @param po 関数リスト
   */
  addPluginObject (objName, po) {
    if (this.pluginfiles[objName] === undefined) {
      this.pluginfiles[objName] = '*' // dummy
      if (typeof (po['初期化']) === 'object') {
        const def = po['初期化']
        delete po['初期化']
        const initkey = `!${objName}:初期化`
        po[initkey] = def
        this.used_func[initkey] = true
      }
      this.addPlugin(po)
    }
  }

  /**
   * プラグイン・ファイルを追加(Node.js向け)
   * @param objName オブジェクト名
   * @param path ファイルパス
   * @param po 登録するオブジェクト
   */
  addPluginFile (objName, path, po) {
    this.addPluginObject(objName, po)
    if (this.pluginfiles[objName] === undefined) {
      this.pluginfiles[objName] = path
    }
  }

  /**
   * 関数を追加する
   * @param key 関数名
   * @param josi 助詞
   * @param fn 関数
   */
  addFunc (key, josi, fn) {
    this.plugins[key] = {'josi': josi}
    this.setFunc(key, fn)
  }

  /**
   * 関数をセットする
   * @param key 関数名
   * @param fn 関数
   */
  setFunc (key, fn) {
    this.plugins[key].fn = fn
    this.__varslist[0][key] = fn
  }

  /**
   * プラグイン関数を参照する
   * @param key プラグイン関数の関数名
   * @returns プラグイン・オブジェクト
   */
  getFunc (key) {
    return this.plugins[key]
  }

  /**
   * 関数を先に登録してしまう
   */
  registerFunction (ast) {
    if (ast.type !== 'block') {
      throw new NakoGenError('構文解析に失敗しています。構文は必ずblockが先頭になります')
    }
    for (let i = 0; i < ast.block.length; i++) {
      const t = ast.block[i]
      if (t.type === 'def_func') {
        const name = t.name.value
        this.used_func[name] = true
        this.__varslist[1][name] = function () { } // 事前に適当な値を設定
        this.nako_func[name] = {
          'josi': t.name.meta.josi,
          'fn': '',
          'type': 'func'
        }
      }
    }
  }

  convLineno (node) {
    if (node.line === undefined) return ''
    return `__varslist[0].line=${node.line};`
  }

  convGen (node) {
    let code = ''
    if (node instanceof Array) {
      for (let i = 0; i < node.length; i++) {
        const n = node[i]
        code += this.convGen(n)
      }
      return code
    }
    if (node === null) return 'null'
    if (node === undefined) return 'undefined'
    if (typeof (node) !== 'object') return '' + node
    // switch
    switch (node.type) {
      case 'nop':
        break
      case 'block':
        for (let i = 0; i < node.block.length; i++) {
          const b = node.block[i]
          code += this.convGen(b)
        }
        break
      case 'comment':
        code += this.convLineno(node)
        code += '/*' + node.value + '*/\n'
        break
      case 'eol':
        code += ';' + this.convLineno(node) + '// ' + node.value + '\n'
        break
      case 'break':
        code += this.convCheckLoop(node, 'break')
        break
      case 'continue':
        code += this.convCheckLoop(node, 'continue')
        break
      case 'end':
        code += '__varslist[0][\'終\']();'
        break
      case 'number':
        code += node.value
        break
      case 'string':
        code += this.convString(node)
        break
      case 'def_local_var':
        code += this.convDefLocalVar(node)
        break
      case 'let':
        code += this.convLet(node)
        break
      case 'word':
      case 'variable':
        code += this.convGetVar(node)
        break
      case 'op':
      case 'calc':
        code += this.convOp(node)
        break
      case 'renbun':
        code += this.convRenbun(node)
        break
      case 'not':
        code += '((' + this.convGen(node.value) + ')?0:1)'
        break
      case 'func':
        code += this.convFunc(node, true)
        break
      case 'calc_func':
        code += this.convFunc(node, false)
        break
      case 'if':
        code += this.convIf(node)
        break
      case 'for':
        code += this.convFor(node)
        break
      case 'foreach':
        code += this.convForeach(node)
        break
      case 'repeat_times':
        code += this.convRepeatTimes(node)
        break
      case 'while':
        code += this.convWhile(node)
        break
      case 'let_array':
        code += this.convLetArray(node)
        break
      case 'ref_array':
        code += this.convRefArray(node)
        break
      case 'json_array':
        code += this.convJsonArray(node)
        break
      case 'json_obj':
        code += this.convJsonObj(node)
        break
      case 'func_obj':
        code += this.convFuncObj(node)
        break
      case 'embed_code':
        code += '' + node.value + ''
        break
      case 'bool':
        code += (node.value) ? 'true' : 'false'
        break
      case 'null':
        code += 'null'
        break
      case 'def_func':
        code += this.convDefFunc(node)
        break
      case 'return':
        code += this.convReturn(node)
        break
      case 'try_except':
        code += this.convTryExcept(node)
        break
      default:
        throw new Error('System Error: unknown_type=' + node.type)
    }
    return code
  }

  varname (name) {
    return `__vars["${name}"]`
  }

  findVar (name) {
    // __vars ?
    if (this.__vars[name] !== undefined) {
      return {i: this.__varslist.length - 1, 'name': name, isTop: true}
    }
    // __varslist ?
    for (let i = this.__varslist.length - 2; i >= 0; i--) {
      const vlist = this.__varslist[i]
      if (!vlist) continue
      if (vlist[name] !== undefined) {
        return {'i': i, 'name': name, isTop: false}
      }
    }
    return null
  }

  genVar (name, line) {
    const res = this.findVar(name)
    const lno = line
    if (res === null) {
      return `__vars["${name}"]/*?:${lno}*/`
    }
    const i = res.i
    // システム関数・変数の場合
    if (i === 0) {
      const pv = this.plugins[name]
      if (!pv) return `__vars["${name}"]/*err:${lno}*/`
      if (pv.type === 'const' || pv.type === 'var') return `__varslist[0]["${name}"]`
      if (pv.type === 'func') {
        if (pv.josi.length === 0) {
          return `(__varslist[${i}]["${name}"]())`
        }
        throw new NakoGenError(`『${name}』が複文で使われました。単文で記述してください。(v1非互換)`, line)
      }
      throw new NakoGenError(`『${name}』は関数であり参照できません。`, line)
    }
    if (res.isTop) {
      return `__vars["${name}"]`
    } else {
      return `__varslist[${i}]["${name}"]`
    }
  }

  convGetVar (node) {
    const name = node.value
    return this.genVar(name, node.line)
  }

  convReturn (node) {
    // 関数の中であれば利用可能
    if (typeof (this.__vars['!関数']) === 'undefined') {
      throw new NakoGenError('『戻る』がありますが、関数定義内のみで使用可能です。', node.line)
    }
    const lno = this.convLineno(node)
    let value
    if (node.value) {
      value = this.convGen(node.value)
      return lno + `return ${value};`
    } else {
      value = this.sore
      return lno + `return ${value};`
    }
  }

  convCheckLoop (node, cmd) {
    // ループの中であれば利用可能
    if (!this.flagLoop) {
      const cmdj = (cmd === 'continue') ? '続ける' : '抜ける'
      throw new NakoGenError(`『${cmdj}』文がありますが、それは繰り返しの中で利用してください。`, node.line)
    }
    return this.convLineno(node.line) + cmd + ';'
  }

  convDefFuncCommon (node, name, args) {
    let code = '(function(){\n'
    code += 'try { __vars = {\'それ\':\'\'}; __varslist.push(__vars);\n'
    this.__vars = {'それ': true, '!関数': name}
    // ローカル変数をPUSHする
    this.__varslist.push(this.__vars)
    // 引数をローカル変数に設定
    let meta = (!name) ? node.meta : node.name.meta
    for (let i = 0; i < meta.varnames.length; i++) {
      const word = meta.varnames[i]
      code += `__vars["${word}"] = arguments[${i}];\n`
    }
    // 関数定義は、グローバル領域で。
    if (name) {
      this.used_func[name] = true
      this.__varslist[1][name] = function () {
      } // 再帰のために事前に適当な値を設定
      this.nako_func[name] = {
        'josi': node.name.meta.josi,
        'fn': '',
        'type': 'func'
      }
    }
    // ブロックを解析
    const block = this.convGen(node.block)
    code += block + '\n'
    // 関数の最後に、変数「それ」をreturnするようにする
    code += `return (${this.sore});\n`
    // 関数の末尾に、ローカル変数をPOP
    const popcode =
      '__varslist.pop(); ' +
      '__vars = __varslist[__varslist.length-1];'
    code += `} finally { ${popcode} }\n`
    code += `}/* end ${name} */)`
    if (name) {
      this.nako_func[name]['fn'] = code
    }
    this.__vars = this.__varslist.pop()
    if (name) {
      this.__varslist[1][name] = code
    }
    return code
  }

  convDefFunc (node) {
    const name = this.getFuncName(node.name.value)
    const args = node.args
    this.convDefFuncCommon(node, name, args)
    // ★この時点では関数のコードを生成しない★
    // プログラム冒頭でコード生成時に関数定義を行う
    // return `__vars["${name}"] = ${code};\n`;
    return ''
  }

  convFuncObj (node) {
    const args = node.args
    const code = this.convDefFuncCommon(node, '', args)
    return code
  }

  convJsonObj (node) {
    const list = node.value
    const codelist = list.map((e) => {
      const key = this.convGen(e.key)
      const val = this.convGen(e.value)
      return `${key}:${val}`
    })
    return '{' + codelist.join(',') + '}'
  }

  convJsonArray (node) {
    const list = node.value
    const codelist = list.map((e) => {
      return this.convGen(e)
    })
    return '[' + codelist.join(',') + ']'
  }

  convRefArray (node) {
    const name = this.convGen(node.name)
    const list = node.index
    let code = name
    for (let i = 0; i < list.length; i++) {
      const idx = this.convGen(list[i])
      code += '[' + idx + ']'
    }
    return code
  }

  convLetArray (node) {
    const name = this.convGen(node.name)
    const list = node.index
    let code = name
    for (let i = 0; i < list.length; i++) {
      const idx = this.convGen(list[i])
      code += '[' + idx + ']'
    }
    const value = this.convGen(node.value)
    code += ' = ' + value + ';\n'
    return this.convLineno(node) + code
  }

  convGenLoop (node) {
    const tmpflag = this.flagLoop
    this.flagLoop = true
    try {
      return this.convGen(node)
    } finally {
      this.flagLoop = tmpflag
    }
  }

  convFor (node) {
    const kara = this.convGen(node.from)
    const made = this.convGen(node.to)
    const block = this.convGenLoop(node.block)
    let word = ''
    let varCode = ''
    if (node.word !== null) {
      word = this.convGen(node.word)
      varCode = ''
    } else {
      // ループ変数を省略した時は、自動で生成する
      const id = this.loop_id++
      word = `$nako_i${id}`
      varCode = 'let '
    }
    const code =
      `for(${varCode}${word}=${kara}; ${word}<=${made}; ${word}++)` + '{\n' +
      `  ${this.sore} = ${word};` + '\n' +
      '  ' + block + '\n' +
      '};\n'
    return this.convLineno(node) + code
  }

  convForeach (node) {
    let target
    if (node.target === null) {
      target = this.sore
    } else {
      target = this.convGen(node.target)
    }
    const block = this.convGenLoop(node.block)
    const id = this.loop_id++
    const key = this.varname('対象キー')
    const name = (node.name) ? node.name.value : '対象'
    this.__vars[name] = true
    this.__vars['対象キー'] = true
    const nameS = this.varname(name)
    const code =
      `let $nako_foreach_v${id}=${target};\n` +
      `for (let $nako_i${id} in $nako_foreach_v${id})` + '{\n' +
      `${nameS} = ${this.sore} = $nako_foreach_v${id}[$nako_i${id}];` + '\n' +
      `${key} = $nako_i${id};\n` +
      '' + block + '\n' +
      '};\n'
    return this.convLineno(node) + code
  }

  convRepeatTimes (node) {
    const id = this.loop_id++
    const value = this.convGen(node.value)
    const block = this.convGenLoop(node.block)
    const kaisu = this.varname('回数')
    const code =
      `for(var $nako_i${id} = 1; $nako_i${id} <= ${value}; $nako_i${id}++)` + '{\n' +
      `  ${this.sore} = ${kaisu} = $nako_i${id};` + '\n' +
      '  ' + block + '\n}\n'
    return this.convLineno(node) + code
  }

  convWhile (node) {
    const cond = this.convGen(node.cond)
    const block = this.convGenLoop(node.block)
    const code =
      `while (${cond})` + '{\n' +
      `  ${block}` + '\n' +
      '}\n'
    return this.convLineno(node) + code
  }

  convIf (node) {
    const expr = this.convGen(node.expr)
    const block = this.convGen(node.block)
    const falseBlock = (node.false_block === null)
      ? ''
      : 'else {' + this.convGen(node.false_block) + '};\n'
    const code =
      this.convLineno(node) +
      `if (${expr}) {\n  ${block}\n}` + falseBlock + ';\n'
    return code
  }

  getFuncName (name) {
    let name2 = name.replace(/[ぁ-ん]+$/, '')
    if (name2 === '') name2 = name
    return name2
  }

  convFuncGetArgsCalcType (funcName, func, node) {
    const args = []
    for (let i = 0; i < node.args.length; i++) {
      const arg = node.args[i]
      if (i === 0 && arg === null) {
        args.push(this.sore)
      } else {
        args.push(this.convGen(arg))
      }
    }
    return args
  }

  getPluginList () {
    const r = []
    for (const name in this.pluginfiles) r.push(name)
    return r
  }

  /**
   * 関数の呼び出し
   * @param node
   * @param  isNakoType
   * @returns string コード
   */
  convFunc (node, isNakoType) {
    const funcName = this.getFuncName(node.name)
    let funcNameS
    const res = this.findVar(funcName)
    if (res === null) {
      throw new NakoGenError(`関数『${funcName}』が見当たりません。有効プラグイン=[` + this.getPluginList().join(',') + ']', node.line)
    }
    let func
    if (res.i === 0) { // plugin function
      func = this.plugins[funcName]
      funcNameS = `__varslist[0]["${funcName}"]`
      if (func.type !== 'func') {
        throw new NakoGenError(`『${funcName}』は関数ではありません。`, node.line)
      }
    } else {
      func = this.nako_func[funcName]
      if (func === undefined) {
        // throw new NakoGenError(`『${funcName}』は関数ではありません。`, node.line)
        // 無名関数の可能性
        func = { return_none: false }
      }
      funcNameS = `__varslist[${res.i}]["${funcName}"]`
    }
    // 関数定義より助詞を一つずつ調べる
    let args = []
    args = this.convFuncGetArgsCalcType(funcName, func, node)
    // function
    if (typeof (this.used_func[funcName]) === 'undefined') {
      this.used_func[funcName] = true
    }
    // 関数呼び出しで、引数の末尾にthisを追加する-システム情報を参照するため
    args.push('__self')
    let argsCode = args.join(',')
    let code = `${funcNameS}(${argsCode})`
    if (func.return_none) {
      code = `${code};\n`
    } else {
      code = `(()=>{ const tmp=${this.sore}=${code}; return tmp })()`
      // ...して
      if (node.josi === 'して') {
        code += ';\n'
      }
    }
    return code
  }

  convRenbun (node) {
    let right = this.convGen(node.right)
    let left = this.convGen(node.left)
    return `(() => {${left}; return ${right}})()`
  }

  convOp (node) {
    const OP_TBL = { // トークン名からJS演算子
      '&': '+""+',
      'eq': '==',
      'noteq': '!=',
      'gt': '>',
      'lt': '<',
      'gteq': '>=',
      'lteq': '<='
    }
    const NUM_OP_TBL = { // 数値限定演算子
      '+': true, '-': true, '*': true, '/': true, '%': true, '^': true
    }
    let op = node.operator // 演算子
    let right = this.convGen(node.right)
    let left = this.convGen(node.left)
    if (NUM_OP_TBL[op]) {
      left = `parseFloat(${left})`
      right = `parseFloat(${right})`
    }
    // 階乗
    if (op === '^') {
      return '(Math.pow(' + left + ',' + right + '))'
    }
    // 一般的なオペレータに変換
    if (OP_TBL[op]) op = OP_TBL[op]
    //
    return `(${left} ${op} ${right})`
  }

  convLet (node) {
    // もし値が省略されていたら、変数「それ」に代入する
    let value = this.sore
    if (node.value) value = this.convGen(node.value)
    // 変数名
    const name = node.name.value
    const res = this.findVar(name)
    let isTop
    let code = ''
    if (res === null) {
      this.__vars[name] = true
      isTop = true
    } else {
      isTop = res.isTop
      // 定数ならエラーを出す
      if (this.__varslist[res.i].meta) {
        if (this.__varslist[res.i].meta[name]) {
          if (this.__varslist[res.i].meta[name].readonly) {
            throw new NakoGenError(
              `定数『${name}』に値を代入することはできません。`,
              node.line)
          }
        }
      }
    }
    if (isTop) {
      code = `__vars["${name}"]=${value};`
    } else {
      code = `__varslist[${res.i}]["${name}"]=${value};`
    }
    return ';' + this.convLineno(node) + code + '\n'
  }

  convDefLocalVar (node) {
    const value = (node.value === null) ? 'null' : this.convGen(node.value)
    const name = node.name.value
    const vtype = node.vartype // 変数 or 定数
    // 二重定義？
    if (this.__vars[name] !== undefined) {
      throw new NakoGenError(
        `${vtype}『${name}』の二重定義はできません。`,
        node.line)
    }
    //
    this.__vars[name] = true
    if (vtype === '定数') {
      if (!this.__vars.meta) {
        this.__vars.meta = {}
      }
      if (!this.__vars.meta[name]) this.__vars.meta[name] = {}
      this.__vars.meta[name].readonly = true
    }
    const code = `__vars["${name}"]=${value};\n`
    return this.convLineno(node) + code
  }

  convPrint (node) {
    return `__print(${node});`
  }

  convString (node) {
    let value = '' + node.value
    let mode = node.mode
    value = value.replace(/\\/g, '\\\\')
    value = value.replace(/"/g, '\\"')
    value = value.replace(/\r/g, '\\r')
    value = value.replace(/\n/g, '\\n')
    if (mode === 'ex') {
      let rf = (a, name) => {
        return '"+' + this.genVar(name) + '+"'
      }
      value = value.replace(/\{(.+?)\}/g, rf)
      value = value.replace(/｛(.+?)｝/g, rf)
    }
    return '"' + value + '"'
  }

  convTryExcept (node) {
    const block = this.convGen(node.block)
    const errBlock = this.convGen(node.errBlock)
    return this.convLineno(node.line) +
      `try {\n${block}\n} catch (e) {\n` +
      '__varslist[0]["エラーメッセージ"] = e.message;\n' +
      ';\n' +
      `${errBlock}}\n`
  }
}

module.exports = NakoGen
