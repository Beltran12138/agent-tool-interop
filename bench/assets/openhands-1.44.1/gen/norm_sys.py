import sys, re
s = open(sys.argv[1], encoding='utf-8').read()
s = s.replace('combine multiple powershell commands', 'combine multiple bash commands').replace('curl|powershell', 'curl|bash')
ref = open(sys.argv[2], encoding='utf-8').read()
ref_body = re.sub(r'\n\n<CURRENT_DATETIME>\n.*?\n</CURRENT_DATETIME>\s*$', '', ref, flags=re.S)
print('identical to logged prompt (minus datetime):', s == ref_body, len(s), len(ref_body))
open(sys.argv[3], 'w', encoding='utf-8', newline='\n').write(s)
