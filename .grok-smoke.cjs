const { execFile } = require('node:child_process');
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(XAI_API_KEY|GROK_API_KEY|OPENAI_API_KEY)$/.test(key)) delete env[key];
const schema = {type:'object',additionalProperties:false,properties:{calories:{type:'number'},protein:{type:'number'}},required:['calories','protein']};
execFile('C:\\Users\\jx-v1\\.grok\\bin\\grok.exe', ['--cwd', process.cwd(), '--tools', '', '--disable-web-search', '--no-subagents', '--no-plan', '--permission-mode', 'dontAsk', '--max-turns', '1', '--system-prompt-override', 'Estimate food macros from general knowledge. No tools. Return only the requested JSON.', '--json-schema', JSON.stringify(schema), '-p', 'Estimate calories and protein for one large boiled egg.'], {env, windowsHide:true,timeout:90000,maxBuffer:20000}, (error,stdout,stderr)=>{console.log(JSON.stringify({code:error?.code ?? 0,stdout,stderr}));});
