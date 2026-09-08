import re
with open('public/app.js', 'r', encoding='utf-8') as f:
    app = f.read()

trainings_block_match = re.search(r'(// ============================================================\r?\n// . TRAINING MODULE \(WORKER & ADMIN\).*?)(?=\r?\n// ============================================================)', app, re.DOTALL)
if not trainings_block_match:
    print("Could not find training block")
    exit(1)
trainings_block = trainings_block_match.group(1)

drills_block = trainings_block.replace('TRAINING MODULE', 'DRILLS MODULE')
drills_block = drills_block.replace('🎓', '🚨')
drills_block = drills_block.replace('Training', 'Drill')
drills_block = drills_block.replace('training', 'drill')
drills_block = drills_block.replace('trn', 'drl')
drills_block = drills_block.replace('المحاضرة', 'التجربة')
drills_block = drills_block.replace('محاضرة', 'تجربة')
drills_block = drills_block.replace('المحاضرات', 'تجارب الأداء')
drills_block = drills_block.replace('Trn', 'Drl')
drills_block = drills_block.replace('TRN', 'DRL')
drills_block = drills_block.replace('التدريب', 'الأداء')
drills_block = drills_block.replace('trainings', 'drills')
drills_block = drills_block.replace('سجل حضور التجربة', 'سجل حضور تجارب الأداء')

app = re.sub(r'(// ============================================================\r?\n// . LIGHTBOX LOGIC)', drills_block + '\n\n' + r'\1', app)

with open('public/app.js', 'w', encoding='utf-8') as f:
    f.write(app)
print("Injected drills block successfully.")
