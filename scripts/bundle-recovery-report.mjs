import fs from 'node:fs';
const files=['T13-database-restore','T13-erp-restore','T13-image-audit','T13-rollback'];
const reports=files.map(name=>JSON.parse(fs.readFileSync('test-results/'+name+'.json','utf8')));
if(reports.some(report=>report.result!=='passed'))throw new Error('Recovery evidence is incomplete');
fs.writeFileSync('evidence/reports/T13-recovery.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',reports},null,2)+'\n');
console.log('Four actual recovery and image reports verified');
