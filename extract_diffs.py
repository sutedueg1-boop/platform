import re
with open('extract_history_direct.txt', 'r', encoding='utf-8') as f:
    text = f.read()

diffs = re.findall(r'\[diff_block_start\](.*?)\[diff_block_end\]', text, re.DOTALL)
for i, diff in enumerate(diffs):
    with open(f'scratch/diff_{i}.patch', 'w', encoding='utf-8') as f:
        f.write(diff.strip())
print(f"Extracted {len(diffs)} diffs.")
