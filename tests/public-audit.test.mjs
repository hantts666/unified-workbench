import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {audit} from '../scripts/public-audit.mjs';

test('公开扫描识别凭据与数据库副本且不回显秘密',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'unified-audit-test-'));
  t.after(()=>{
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'unified-audit-test-')));
    fs.rmSync(root,{recursive:true,force:true});
  });
  const syntheticToken=['gh','p_', 'x'.repeat(36)].join('');
  fs.writeFileSync(path.join(root,'config.txt'),syntheticToken);
  fs.writeFileSync(path.join(root,'snapshot.sql'),'synthetic database contents');
  const result=audit(root);
  assert.ok(result.findings.some(value=>value.includes('config.txt')));
  assert.ok(result.findings.some(value=>value.includes('snapshot.sql')));
  assert.ok(result.findings.every(value=>!value.includes(syntheticToken)));
});
