# 可以用来预览生成的几何图形，帮助调试和验证视觉工具的输出是否正确，但不属于工作流的核心部分。
from manim import *

class GeometryScene(Scene):

    def construct(self, scene):

        points = {}

        for p in scene.points.values():

            x = (p.pos[0] - 0.5) * 6
            y = (p.pos[1] - 0.5) * 4

            dot = Dot([x, y, 0])
            label = Text(p.id).scale(0.5).next_to(dot, UP)

            points[p.id] = dot

            self.play(Create(dot), Write(label))

        for line in scene.lines.values():

            p1, p2 = line.points

            l = Line(
                points[p1].get_center(),
                points[p2].get_center()
            )

            self.play(Create(l))

        for obj in scene.objects.values():

            if obj.type == "triangle":

                A, B, C = obj.points

                triangle = Polygon(
                    points[A].get_center(),
                    points[B].get_center(),
                    points[C].get_center()
                )

                self.play(Create(triangle))
