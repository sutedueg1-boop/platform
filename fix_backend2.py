import re

with open('server.js', 'r', encoding='utf-8') as f:
    server = f.read()

routes_match = re.search(r'(// 🎓 API ROUTES — HSE TRAINING MODULE.*?)(?=\r?\n// ============================================================\r?\n// 🔔 API ROUTES — NOTIFICATION CENTER)', server, re.DOTALL)
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
    
    server = server.replace(trainings_routes, trainings_routes + '\n\n// ============================================================\n' + drills_routes)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server)

print("Backend API routes properly updated.")
