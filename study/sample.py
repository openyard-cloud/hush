"""Samples public commits from GitHub search, one commit per repository, keeping the patches of source files.

    python3 study/sample.py claude.jsonl '"Co-Authored-By: Claude" committer-date:2026-11-01..2026-11-16' 200
    python3 study/sample.py base.jsonl 'fix committer-date:2021-03-01..2021-03-20' 200

Needs the GitHub CLI (gh), logged in. Forks, vendored, minified and generated files are skipped.
"""
import json,subprocess,sys,time,re,os
OUT=sys.argv[1]; Q=sys.argv[2]; N=int(sys.argv[3])
SRC=re.compile(r'\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|scala|dart)$')
def api(path,params=None):
    cmd=['gh','api','-X','GET',path]
    for k,v in (params or {}).items(): cmd+=['-f',f'{k}={v}']
    for t in range(4):
        r=subprocess.run(cmd,capture_output=True,text=True)
        if r.returncode==0: return json.loads(r.stdout)
        if 'rate limit' in r.stderr.lower(): time.sleep(30); continue
        return None
seen=set(); picks=[]
for page in range(1,11):
    d=api('search/commits',{'q':Q,'per_page':100,'page':page})
    if not d: break
    for it in d.get('items',[]):
        repo=it['repository']['full_name']
        if repo in seen or it['repository'].get('fork'): continue
        seen.add(repo); picks.append((repo,it['sha']))
    time.sleep(2.5)
    if len(picks)>=N*2: break
out=open(OUT,'w'); got=0
for repo,sha in picks:
    if got>=N: break
    c=api(f'repos/{repo}/commits/{sha}')
    if not c: continue
    files=[{'f':f['filename'],'patch':f.get('patch','')} for f in c.get('files',[]) if SRC.search(f['filename']) and f.get('patch') and '/vendor/' not in f['filename'] and 'node_modules' not in f['filename'] and not re.search(r'\.min\.|generated|_pb2|\.lock',f['filename'])]
    if not files: continue
    out.write(json.dumps({'repo':repo,'sha':sha,'files':files})+'\n'); got+=1
print(OUT,got)
