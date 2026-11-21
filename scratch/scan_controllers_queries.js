'use strict';

const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, '../backend/src/controllers');
const files = fs.readdirSync(controllersDir).filter(f => f.endsWith('.js'));

const findings = [];

files.forEach(file => {
  const content = fs.readFileSync(path.join(controllersDir, file), 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    // Look for findById, findByIdAndUpdate, findByIdAndDelete, findOne(
    if (line.includes('findById(') || line.includes('findByIdAndUpdate(') || line.includes('findByIdAndDelete(')) {
      findings.push({
        file,
        lineNum,
        type: 'findById_call',
        text: line.trim()
      });
    }
  });
});

console.log(`Found ${findings.length} findById calls:`);
findings.forEach(f => {
  console.log(`${f.file}:${f.lineNum} -> ${f.text}`);
});
