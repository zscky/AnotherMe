import sys
import os
import json

# Ensure we are in the correct directory
current_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(current_dir)
sys.path.append('.')

from agents.perception.vision_agent import VisionAgent
from agents.perception.geometry_fact_compiler import GeometryFactCompiler
from agents.perception.coordinate_scene import CoordinateSceneCompiler

def reproduce():
    # raw_bundle
    raw_bundle = {
        "problem_text": "In rhombus ABCD, angle A is 60 degrees. E is the midpoint of AD and F is the midpoint of AB. The rhombus is folded along EF so that A moves to A'. If the distance from A' to the plane BCDE is 3/4 of the side length of the rhombus, find the cosine of the angle between plane A'EF and plane BCDE.",
        "geometry_facts": {
            "shapes": {
                "ABCD": "rhombus",
                "E": "point",
                "F": "point",
                "A_prime": "point"
            },
            "relations": [
                "angle(D, A, B) == 60",
                "E == midpoint(A, D)",
                "F == midpoint(A, B)",
                "folded_along(ABCD, E, F, A, A_prime)"
            ],
            "measurements": []
        }
    }

    config = {"max_retries": 3}
    vision_agent = VisionAgent(config=config)

    # Instead of _stabilize_problem_bundle which is failing to keep our relations, 
    # let's look at what the test does.
    # The test likely expects that if 'relations' are provided, they should be used.
    # However, _stabilize_problem_bundle seems to rebuild everything.
    # Let's try to bypass stabilization if it's not working as expected for pure reproduction of the later parts.
    # OR, better, let's inject the relations INTO the stabilized output to see how the compiler handles them.
    
    stabilized = vision_agent._stabilize_problem_bundle(raw_bundle, image_path=None)
    # FORCE relations back in if they were lost, to test the compiler pipeline
    if not stabilized['geometry_facts']['relations']:
        stabilized['geometry_facts']['relations'] = raw_bundle['geometry_facts']['relations']

    gf_compiler = GeometryFactCompiler()
    compiled_data = gf_compiler.compile(stabilized['geometry_facts'])
    
    cs_compiler = CoordinateSceneCompiler()
    geometry_spec = cs_compiler.normalize_geometry_spec(compiled_data)

    print("1) stabilized['geometry_facts']['measurements']:")
    print(json.dumps(stabilized['geometry_facts'].get('measurements', []), indent=2))

    print("\n2) text_explicit_measurements:")
    print(json.dumps(compiled_data.get('text_explicit_measurements', []), indent=2))
    print("derived_measurements:")
    print(json.dumps(compiled_data.get('derived_measurements', []), indent=2))

    print("\n3) geometry_spec['measurements']:")
    print(json.dumps(geometry_spec.get('measurements', []), indent=2))

    print("\n4) geometry_spec['constraints'] (point_on_segment/midpoint):")
    filtered_constraints = [
        c for c in geometry_spec.get('constraints', [])
        if c.get('type') in ['point_on_segment', 'midpoint']
    ]
    print(json.dumps(filtered_constraints, indent=2))

if __name__ == '__main__':
    reproduce()
