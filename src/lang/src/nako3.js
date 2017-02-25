//
// nadesiko ver3
//

// なでしこのグローバル変数
const __vars = {};
let __print = (msg) => {
  console.log(msg);
};
const peg = require('./nako_parser.js');
const gen = require('./nako_gen.js');

if (typeof(navigator) == "object") {
  setTimeout(()=>{
    nako3_browser();
  },1);
}

function nako3_browser(){
  // 書き換え
  __print = (msg) => {
    msg = "" + msg;
    msg = msg
      .replace("&", "&amp;")
      .replace(">", "&gt;")
      .replace("<", "&lt;");
    const e = document.getElementById("info");
    e.innerHTML += msg + "<br>\n";
  };
  navigator.nako3_run = nako3_run;
  // スクリプトタグの中身を得る
  let scripts = document.querySelectorAll("script");
  for (let i = 0; i < scripts.length; i++) {
    let script = scripts[i];
    let type = script.type;
    if (type == "nako" || type =="なでしこ") {
      nako3_browser_run_script(script);
    }
  }
}

function nako3_browser_run_script(script) {
  let code = script.text;
  let type = script.type;
  let option = script.option;
  nako3_run(code);
}

function nako3_run(code) {
  console.log("//--- code ---");
  console.log(code);
  console.log("//--- /code ---");
  const ast = peg.parse(code + "\n");
  const js = gen.generate(ast, false, __print);
  console.log(js);
  eval(js);
}






