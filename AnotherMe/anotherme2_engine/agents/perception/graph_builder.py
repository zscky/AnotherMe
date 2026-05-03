"""
几何图构建器 - 使用 NetworkX 构建几何图形的图结构表示
"""
import networkx as nx


class GeometryGraph:

    def __init__(self, scene):

        # 使用 MultiGraph 避免同一对节点间多条语义边互相覆盖。
        self.graph = nx.MultiGraph()

        self.add_points(scene)
        self.add_lines(scene)
        self.add_objects(scene)
        self.add_angles(scene)
        self.add_incidence(scene)
        self.add_relations(scene)

    def _add_relation_hypernode(self, category, rel_type, entities, attrs, index):

        entities = entities or []
        rel_id = f"{category}_{rel_type}_{index}"

        while rel_id in self.graph:
            rel_id = f"{rel_id}_x"

        node_attrs = {
            "type": category,
            "relation_type": rel_type,
            "entities": list(entities),
        }
        if attrs:
            node_attrs.update(attrs)

        self.graph.add_node(rel_id, **node_attrs)

        for order, entity in enumerate(entities):
            self.graph.add_edge(
                rel_id,
                entity,
                type=f"{category}_member",
                relation_type=rel_type,
                order=order,
            )

        return rel_id

    def add_points(self, scene):

        for p in scene.points.values():

            self.graph.add_node(
                p.id,
                type="point",
                pos=p.pos,
            )

    def add_lines(self, scene):

        for line in scene.lines.values():

            self.graph.add_node(
                line.id,
                type="line",
                line_type=line.type,
                points=list(line.points),
                **(line.attrs or {}),
            )

            for idx, point_id in enumerate(line.points):
                self.graph.add_edge(
                    line.id,
                    point_id,
                    type="line_endpoint",
                    line_id=line.id,
                    order=idx,
                )

            if len(line.points) == 2:
                p1, p2 = line.points
                self.graph.add_edge(
                    p1,
                    p2,
                    type="line",
                    id=line.id,
                    line_type=line.type,
                )

    def add_objects(self, scene):

        for obj in scene.objects.values():

            node_attrs = {
                "type": obj.type,
                "entity_class": "object",
            }
            if obj.center is not None:
                node_attrs["center"] = obj.center
            if obj.radius_point is not None:
                node_attrs["radius_point"] = obj.radius_point
            if obj.attrs:
                node_attrs.update(obj.attrs)

            self.graph.add_node(obj.id, **node_attrs)

            if obj.points:

                for p in obj.points:

                    self.graph.add_edge(
                        obj.id,
                        p,
                        type="object_member",
                    )

            if obj.center:
                self.graph.add_edge(
                    obj.id,
                    obj.center,
                    type="object_center",
                )

            if obj.radius_point:
                self.graph.add_edge(
                    obj.id,
                    obj.radius_point,
                    type="object_radius_point",
                )

    def add_angles(self, scene):

        for angle in scene.angles.values():

            node_attrs = {
                "type": "angle",
                "points": list(angle.points),
                "value": angle.value,
            }
            if angle.attrs:
                node_attrs.update(angle.attrs)

            self.graph.add_node(angle.id, **node_attrs)

            for idx, point_id in enumerate(angle.points):
                role = "vertex" if idx == 1 else "arm"
                self.graph.add_edge(
                    angle.id,
                    point_id,
                    type="angle_member",
                    role=role,
                    order=idx,
                )

    def add_incidence(self, scene):

        for idx, incidence in enumerate(scene.incidence):
            entities = incidence.entities or []
            attrs = incidence.attrs or {}

            if len(entities) == 2:
                self.graph.add_edge(
                    entities[0],
                    entities[1],
                    type="incidence",
                    incidence_type=incidence.type,
                    **attrs,
                )
                continue

            self._add_relation_hypernode(
                category="incidence",
                rel_type=incidence.type,
                entities=entities,
                attrs=attrs,
                index=idx,
            )

    def add_relations(self, scene):

        for idx, r in enumerate(scene.relations):

            entities = r.entities or []
            attrs = r.attrs or {}

            if len(entities) == 2:

                self.graph.add_edge(
                    entities[0],
                    entities[1],
                    type="relation",
                    relation=r.type,
                    **attrs,
                )
                continue

            self._add_relation_hypernode(
                category="relation",
                rel_type=r.type,
                entities=entities,
                attrs=attrs,
                index=idx,
            )

    def to_payload(self) -> dict:
        """导出可序列化图结构，便于跨智能体传递。"""
        nodes = []
        for node_id, attrs in self.graph.nodes(data=True):
            item = {"id": node_id}
            item.update(attrs)
            nodes.append(item)

        edges = []
        for source, target, edge_key, attrs in self.graph.edges(keys=True, data=True):
            item = {
                "source": source,
                "target": target,
                "key": edge_key,
            }
            item.update(attrs)
            edges.append(item)

        return {
            "nodes": nodes,
            "edges": edges,
            "stats": {
                "graph_type": "MultiGraph",
                "node_count": self.graph.number_of_nodes(),
                "edge_count": self.graph.number_of_edges(),
            }
        }
