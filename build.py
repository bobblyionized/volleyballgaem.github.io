# Builds index.html from the source parts in src/ (concatenated in order).
# Also refuses to build if a line comment looks like it swallowed code: a "//" followed later on the same
# line by "; " + code is almost always an editing accident (it has silently disabled logic several times).
import os, re, sys
root = os.path.dirname(os.path.abspath(__file__))
parts = ['01_head.html', '02_core.js', '03_world.js', '04_game.js']
bad = []
for p in parts[1:]:
    for n, line in enumerate(open(os.path.join(root, 'src', p), encoding='utf-8').read().split('\n'), 1):
        code, sep, comment = line.partition('//')
        if not sep or 'http' in line[:line.find('//') + 8]: continue
        if "'" in code and code.count("'") % 2 == 1: continue          # the // is inside a string
        if re.search(r"; +(?:const |let |var |if \(|for \(|while \(|return|[A-Za-z_$][\w$.]*\s*(?:\(|=(?!=)))", comment):
            bad.append(f"{p}:{n}: comment may have swallowed code: //{comment[:90]}")
        elif re.search(r"[A-Za-z_$][\w$.]*\([^()]*\);\s*$", comment):   # a comment ending in a call like "f(a, b);" - code pasted after a comment
            bad.append(f"{p}:{n}: comment ends in code: //{comment[-90:]}")
if bad:
    print('\n'.join(bad)); print('build refused'); sys.exit(1)
out = ''.join(open(os.path.join(root, 'src', p), encoding='utf-8', newline='').read() for p in parts)
open(os.path.join(root, 'index.html'), 'w', encoding='utf-8', newline='').write(out)
print('built index.html (%d bytes)' % len(out))
