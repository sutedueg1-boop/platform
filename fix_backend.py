import re

with open('server.js', 'r', encoding='utf-8') as f:
    server = f.read()

# Add DRILLS_FILE definition
if 'DRILLS_FILE' not in server:
    server = re.sub(
        r"(const TRAININGS_FILE\s*=\s*path\.join\(DATA_DIR,\s*'trainings\.json'\);)",
        r"\1\nconst DRILLS_FILE = path.join(DATA_DIR, 'drills.json');",
        server
    )
    
    server = re.sub(
        r"(if \(!fs\.existsSync\(TRAININGS_FILE\)\) \{\s*fs\.writeFileSync\(TRAININGS_FILE, JSON\.stringify\(\[\], null, 2\), 'utf8'\);\s*\})",
        r"\1\nif (!fs.existsSync(DRILLS_FILE)) {\n  fs.writeFileSync(DRILLS_FILE, JSON.stringify([], null, 2), 'utf8');\n}",
        server
    )

    rw_match = re.search(r'(function readTrainings\(\).*?function writeTrainings\(data\)[^}]+})', server, re.DOTALL)
    if rw_match:
        rw_trainings = rw_match.group(1)
        rw_drills = rw_trainings.replace('Trainings', 'Drills').replace('TRAININGS_FILE', 'DRILLS_FILE')
        server = server.replace(rw_trainings, rw_trainings + '\n\n' + rw_drills)
    else:
        print("Failed to find readTrainings")

    routes_match = re.search(r'(// ============================================================\r?\n// 🎓 API ROUTES — HSE TRAINING MODULE.*?)(?=\r?\n// ============================================================)', server, re.DOTALL)
    if routes_match:
        trainings_routes = routes_match.group(1)
        drills_routes = trainings_routes.replace('TRAINING MODULE', 'DRILLS MODULE')
        drills_routes = drills_routes.replace('🎓', '🚨')
        drills_routes = drills_routes.replace('Trainings', 'Drills')
        drills_routes = drills_routes.replace('trainings', 'drills')
        drills_routes = drills_routes.replace('Training', 'Drill')
        drills_routes = drills_routes.replace('training', 'drill')
        drills_routes = drills_routes.replace('trn', 'drl')
        drills_routes = drills_routes.replace('المحاضرة', 'التجربة')
        drills_routes = drills_routes.replace('محاضرة', 'تجربة')
        drills_routes = drills_routes.replace('Trn', 'Drl')
        drills_routes = drills_routes.replace('TRN', 'DRL')
        drills_routes = drills_routes.replace('topic', 'title') 
        
        server = server.replace(trainings_routes, trainings_routes + '\n\n' + drills_routes)
    else:
        print("Failed to find trainings routes")

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server)

print("Backend API routes updated.")
