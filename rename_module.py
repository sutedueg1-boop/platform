import re

for filename in ['public/index.html', 'public/app.js']:
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    content = content.replace('تجارب الأداء', 'تجارب الطوارئ')
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)

print("Renamed module successfully.")
