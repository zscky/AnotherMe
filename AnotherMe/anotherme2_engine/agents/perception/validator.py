"""
场景验证器 - 验证场景图的完整性和一致性
"""
class SceneValidator:

    @staticmethod
    def validate(scene):

        SceneValidator.validate_points(scene)
        SceneValidator.validate_lines(scene)
        SceneValidator.validate_objects(scene)
        SceneValidator.validate_relations(scene)

    @staticmethod
    def validate_points(scene):

        for p in scene.points.values():
            if len(p.pos) != 2:
                raise ValueError(f"Point {p.id} position invalid")

    @staticmethod
    def validate_lines(scene):

        for line in scene.lines.values():

            for p in line.points:

                if p not in scene.points:
                    raise ValueError(
                        f"Line {line.id} references unknown point {p}"
                    )

    @staticmethod
    def validate_objects(scene):

        for obj in scene.objects.values():

            if obj.points:
                for p in obj.points:

                    if p not in scene.points:
                        raise ValueError(
                            f"Object {obj.id} references unknown point {p}"
                        )

            if obj.center and obj.center not in scene.points:
                raise ValueError(
                    f"Circle {obj.id} center invalid"
                )

    @staticmethod
    def validate_relations(scene):

        valid_entities = set()

        valid_entities.update(scene.points.keys())
        valid_entities.update(scene.lines.keys())
        valid_entities.update(scene.objects.keys())
        valid_entities.update(scene.angles.keys())

        for rel in scene.relations:

            for e in rel.entities:

                if e not in valid_entities:
                    raise ValueError(
                        f"Relation references unknown entity {e}"
                    )
