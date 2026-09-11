"""
Everything that imports `bpy` lives here, and nothing here is imported by the
pure layer. Each module realises one kind of data the pure layer produced:
a Layout becomes a mesh, a list of Bones becomes an armature, a Clip becomes
an Action, and export.py writes the glb.
"""
