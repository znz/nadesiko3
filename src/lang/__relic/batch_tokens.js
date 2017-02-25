#!/usr/bin/env node

// converter : tokens.txt => tokens.js
const target = __dirname + '/tokens.txt';
const saveto = __dirname + '/tokens.js';

// read
const fs = require('fs');
const data = fs.readFileSync(target, "utf-8");

// convert
const words = [];
const lines = data.split(/[\,\n]/);
lines.forEach( (line) => {
  line = line.replace(/\s+/g, '');
  if (line == '' || line.charAt(0) == '#') return;
  line += "=";
  const cs = line.split(/\s*\=\s*/g);
  let name = cs[0];
  let label = cs[1];
  if (label == "") label = name;
  words.push([name, label]);
});

// sort by label length
words.sort((a,b) => {
  return b[1].length - a[1].length;
});

// make object
const xpt = {};
xpt.dict = {};
xpt.dict_a = [];
for (let id = 0; id < words.length; id++) {
  const w = words[id];
  const name = w[0];
  const label = w[1];
  xpt[name] = id;
  xpt.dict[label] = id;
  xpt.dict_a.push(name);
}



// output
const res = "/// generated by batch_tokens.js\n" +
  "module.exports = " + JSON.stringify(xpt,null,2) + ";";
// output
fs.writeFileSync(saveto, res, "utf-8");
console.log(res);
