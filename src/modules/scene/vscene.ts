/*
//  Copyright 2021 Vircadia contributors.
//  Copyright 2022 DigiSomni LLC.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
*/

// This is disabled because TS complains about BABYLON's use of cap'ed function names
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { AnimationGroup, Engine, MeshBuilder, Scene, SceneLoader,
    ActionManager, ActionEvent, ExecuteCodeAction, ArcRotateCamera, StandardMaterial,
    Mesh, DefaultRenderingPipeline, Camera, AbstractMesh,
    Texture, CubeTexture, TransformNode } from "@babylonjs/core";

import { Color3, Quaternion, Vector3 } from "@babylonjs/core/Maths/math";
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Meshes/meshBuilder";
import { ResourceManager } from "./resource";
import { GameObject, MeshComponent } from "@Modules/object";
import { ScriptComponent, requireScript, requireScriptForNodes } from "@Modules/script";
import { AvatarController, ScriptAvatarController } from "@Modules/avatar";

// General Modules
import Log from "@Modules/debugging/log";
// System Modules
import { v4 as uuidv4 } from "uuid";
import { VVector3 } from ".";

// Domain Modules
import { DomainMgr } from "@Modules/domain";
import { Domain, ConnectionState } from "@Modules/domain/domain";
import { AvatarMixer, Uuid, ScriptAvatar } from "@vircadia/web-sdk";
import { MyAvatarController } from "../avatar/MyAvatarController";


/**
 * this.addEntity() takes parameters describing the entity to create and add to
 * the scene. This interface defines the parameters in the definition object
 * passed to addEntity()
 * @typedef Object EntityProps
 */
interface EntityProps {
    id?: string;        // lookup identifier. One is generated if no specified
    name: string;
    type: "Shape" | "Model";
    shape?: "box" | "sphere" | "cylinder" | "cone" | "triangle" ; // if type=="Shape"
    modelUrl?: string;  // if type=="Model"
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w?: number };
    dimensions: { x: number; y: number; z: number; };   // scaling
    color?: { r: number; g: number; b: number; a?: number };
}

const DefaultAvatarUrl = "https://staging.vircadia.com/O12OR634/UA92/sara.glb";
const AvatarAnimationUrl = "https://staging.vircadia.com/O12OR634/UA92/AnimationsBasic.glb";


/**
 * VScene is the interface to a single scene's state, entities, and operations.
 */
export class VScene {
    _sceneId: number;
    _engine: Engine;
    _scene: Scene;
    _preScene: Nullable<Scene> = null;
    _entities: Map<string, Mesh>;
    _myAvatar: Nullable<GameObject> = null;
    _avatarAnimMesh :Nullable<AbstractMesh> = null;
    _camera : Nullable<Camera> = null;
    _avatarController : Nullable<AvatarController>;
    _avatarList : Map<Uuid, GameObject>;
    _avatarAnimationGroups : AnimationGroup[] = [];
    _avatarMixer : Nullable<AvatarMixer> = null;
    _resourceManager : Nullable<ResourceManager> = null;
    _incrementalMeshList : Nullable<Array<string>> = null;
    _rootUrl = "";

    constructor(pEngine: Engine, pSceneId = 0) {
        if (process.env.NODE_ENV === "development") {
            import("@babylonjs/core/Debug/debugLayer");
            import("@babylonjs/inspector");
        }

        this._engine = pEngine;
        this._entities = new Map<string, Mesh>();
        this._scene = new Scene(pEngine);
        this._sceneId = pSceneId;
        // Listen for the domain to connect and disconnect
        DomainMgr.onActiveDomainStateChange.connect(this._handleActiveDomainStateChange.bind(this));

        // this._scriptAvatarControllers = new Map<Uuid, ScriptAvatarController>();
        this._avatarList = new Map<Uuid, GameObject>();
    }

    getSceneId(): number {
        return this._sceneId;
    }

    getCameraLocation(pCameraId = 0): Vector3 {
        return this._scene.cameras[pCameraId].position.clone();
    }

    setCameraLocation(pLoc: VVector3, pCameraId = 0): void {
        this._scene.cameras[pCameraId].position.set(pLoc.x, pLoc.y, pLoc.z);
    }

    render():void {
        this._scene.render();
    }

    /**
     * Use the Babylon loader to load a model from an URL and return the Mesh
     * @param name asset name to assign to the loaded mesh
     * @param modelUrl URL to load model from
     * @returns Mesh
     * @throws if loading failed
     */
    async importModel(name: string, modelUrl: string): Promise<Mesh> {
        const parsedUrl = new URL(modelUrl);
        const urlWithoutFilename = modelUrl.substring(0, modelUrl.lastIndexOf("/")) + "/";
        const filename = parsedUrl.pathname.split("/").pop();

        // eslint-disable-next-line new-cap
        const meshes = await SceneLoader.ImportMeshAsync(name, urlWithoutFilename, filename, this._scene);
        return meshes.meshes[0] as Mesh;
    }

    /**
     * Add an entity to the scene.
     *
     * The properties block passed specifies whether to create a primitive object (box,
     * sphere, ...) or to load a model from an URL. The created entity is added to the
     * world at the location/rotation described in the properties
     *
     * @param {EntityProps} pProperties object describing entity to create (see EntityProps)
     * @returns {Promise<string>} Id of the created entity or 'null' if failure.
     */
    async addEntity(pProperties: EntityProps): Promise<Nullable<string>> {
        if (!pProperties.type) {
            Log.error(Log.types.ENTITIES, "Failed to specify entity type.");
            return null;
        }

        let entity: Nullable<Mesh> = undefined;

        // If no UUID is given for the entity, we"ll make one now.
        if (!pProperties.id) {
            pProperties.id = uuidv4();
        }

        // Create the entity.
        switch (pProperties.type) {
            case "Shape":
                if (pProperties.shape) {
                    switch (pProperties.shape.toLowerCase()) {
                        case "box":
                            entity = MeshBuilder.CreateBox(pProperties.name, {}, this._scene);
                            break;
                        case "sphere":
                            entity = MeshBuilder.CreateSphere(pProperties.name, {}, this._scene);
                            break;
                        case "cylinder":
                            entity = MeshBuilder.CreateCylinder(pProperties.name, {}, this._scene);
                            break;
                        case "cone":
                            entity = MeshBuilder.CreateCylinder(pProperties.name, { diameterTop: 0 }, this._scene);
                            break;
                        case "triangle":
                            entity = MeshBuilder.CreateCylinder(pProperties.name, { tessellation: 3 }, this._scene);
                            break;
                        default:
                            Log.error(Log.types.ENTITIES, "Failed to create shape entity, unknown/unsupported shape type: "
                                    + pProperties.shape);
                            return null;
                    }
                } else {
                    Log.error(Log.types.ENTITIES, "Attempted to create type Shape with no shape specified");
                    return null;
                }
                break;
            case "Model":
                if (pProperties.modelUrl) {
                    entity = await this.importModel(pProperties.name, pProperties.modelUrl);
                } else {
                    Log.error(Log.types.ENTITIES, "Attempted to create type Model with no modelUrl specified");
                    return null;
                }
                break;
            default:
                Log.error(Log.types.ENTITIES, `Unspecified entity type. props=${JSON.stringify(pProperties)}`);
                entity = MeshBuilder.CreateBox(pProperties.name, {}, this._scene);
                break;
        }

        if (entity) {
            // Set the ID.
            entity.id = pProperties.id;

            // Rotate and position the entity.
            entity.position = new Vector3(pProperties.position.x, pProperties.position.y, pProperties.position.z);
            entity.rotation = new Vector3(pProperties.rotation.x, pProperties.rotation.y, pProperties.rotation.z);

            // Scale the entity.
            entity.scaling = new Vector3(pProperties.dimensions.x, pProperties.dimensions.y, pProperties.dimensions.z);

            // Apply a color if requested.
            if (pProperties.color) {
                const colorMaterial = new StandardMaterial(pProperties.name + "-material", this._scene);
                colorMaterial.emissiveColor = new Color3(pProperties.color.r, pProperties.color.g, pProperties.color.b);
                entity.material = colorMaterial;
            }

            Log.info(Log.types.ENTITIES, "Successfully created entity: " + entity.id);

            this._entities.set(entity.id, entity);

            return entity.id;
        }
        Log.error(Log.types.ENTITIES, "Failed to create entity.");
        return null;
    }

    // Scripting would look like:
    // sceneInstance.deleteById
    deleteEntityById(id: string): void {
        const entityToDelete = this._scene.getNodeByID(id);

        if (entityToDelete) {
            entityToDelete.dispose();
            // eslint-disable-next-line @typescript-eslint/dot-notation
            this._entities.delete(id);
        } else {
            Log.error(Log.types.ENTITIES, `Failed to delete entity by ID: ${id}`);
        }
    }

    // Scripting would look like:
    // sceneInstance.deleteByName
    deleteEntityByName(name: string): void {
        const entityToDelete = this._scene.getNodeByName(name);

        if (entityToDelete) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            this._entities.delete(entityToDelete.id);
            entityToDelete.dispose();
        } else {
            Log.error(Log.types.ENTITIES, `Failed to delete entity by name: ${name}`);
        }
    }

    public async loadSceneSpaceStation(): Promise<void> {
        this._engine.displayLoadingUI();
        this._scene.detachControl();

        this._preScene = this._scene;
        this._createScene();

        await this._loadMyAvatar();
        // setup avatar
        if (this._myAvatar) {
            this._myAvatar.position = new Vector3(0, 49.6, 0);
            this._myAvatar.rotation = new Vector3(0, 0, 0);
        }

        // setup camera
        const camera = this._camera as ArcRotateCamera;
        if (camera) {
            camera.minZ = 0.5;
            camera.maxZ = 250000;
            camera.alpha = -Math.PI / 2;
            camera.beta = Math.PI / 2;
            camera.parent = this._myAvatar as Mesh;
        }

        await this.loadSpaceStationEnvironment();

        this._preScene.dispose();
        this._preScene = null;

        this._scene.executeWhenReady(this._onSceneReady.bind(this));
        await this._scene.whenReadyAsync();
        this._engine.hideLoadingUI();
    }

    public async loadSceneUA92Campus(): Promise<void> {
        this._engine.displayLoadingUI();
        this._scene.detachControl();

        this._preScene = this._scene;
        this._createScene();

        await this._loadMyAvatar();
        // setup avatar
        if (this._myAvatar) {
            this._myAvatar.position = new Vector3(25, 0, 30);
            this._myAvatar.rotation = new Vector3(0, Math.PI, 0);
        }

        // setup camera
        const camera = this._camera as ArcRotateCamera;
        if (camera) {
            camera.minZ = 0.1;
            camera.maxZ = 2000;
            camera.alpha = -Math.PI / 2;
            camera.beta = Math.PI / 2;
            camera.parent = this._myAvatar as Mesh;
        }

        await this.loadUA92CampusEnvironment();

        this._preScene.dispose();
        this._preScene = null;

        this._scene.executeWhenReady(this._onSceneReady.bind(this));
        await this._scene.whenReadyAsync();
        this._engine.hideLoadingUI();
    }

    public async loadSpaceStationEnvironment(): Promise<void> {
        await this._loadEnvironment("https://staging.vircadia.com/O12OR634/SpaceStation/",
            [
                "SpaceStation_Inside_Floor.glb",
                "Collision_Station_Inside.glb"
            ],
            [
                "SpaceStation_HDRI.glb",
                "SpaceStation_Inside_Desk.glb",
                "SpaceStation_Inside_Furniture.glb",
                "SpaceStation_Inside_Light.glb",
                "SpaceStation_Inside_Tableware.glb",
                "SpaceStation_Light.glb",
                "SpaceStation_Planet_A.glb",
                "SpaceStation_Planet_B.glb",
                "SpaceStation_Station_Body_01.glb",
                "SpaceStation_Station_Body_02.glb",
                "SpaceStation_Station_Station_Part.glb",
                "SpaceStation_Stone.glb",
                "SpaceStation_Ship.glb"
            ]
        );

        this._scene.createDefaultEnvironment(
            { createGround: false,
                createSkybox: false,
                environmentTexture: "https://assets.babylonjs.com/textures/night.env" });


        const defaultPipeline = new DefaultRenderingPipeline("default", true, this._scene, this._scene.cameras);
        defaultPipeline.fxaaEnabled = true;

        defaultPipeline.glowLayerEnabled = true;
        if (defaultPipeline.glowLayer) {
            defaultPipeline.glowLayer.blurKernelSize = 16;
            defaultPipeline.glowLayer.intensity = 0.5;
        }
    }

    public async loadUA92CampusEnvironment(): Promise<void> {
        this._scene.createDefaultEnvironment(
            { createGround: false,
                createSkybox: false,
                environmentTexture: "https://assets.babylonjs.com/textures/country.env" });

        await this._loadEnvironment("https://staging.vircadia.com/O12OR634/UA92/",
            [
                "FirstFloor.glb",
                "Outdoors.glb",
                "Collisions.glb"
            ],
            [
                "Exterior.glb",
                "Atirum.glb",
                "Elevator.glb",
                "Furniture.glb",
                "Support.glb",
                "UpperFloors.glb"
            ]
        );

        const skyBox = MeshBuilder.CreateBox("skyBox", { size: 2000 }, this._scene);

        const skyboxMaterial = new StandardMaterial("skyBox", this._scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new CubeTexture(
            "https://assets.babylonjs.com/textures/TropicalSunnyDay", this._scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        skyboxMaterial.specularColor = new Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true;
        skyBox.material = skyboxMaterial;

        const defaultPipeline = new DefaultRenderingPipeline("default", true, this._scene, this._scene.cameras);
        defaultPipeline.fxaaEnabled = true;
    }

    private async _loadMyAvatar() : Promise<void> {
        // Creates, angles, distances and targets the camera
        const camera = new ArcRotateCamera(
            "Camera", -Math.PI / 2, Math.PI / 2, 6,
            new Vector3(0, 1.5, 0), this._scene);

        // This attaches the camera to the canvas
        camera.attachControl(this._scene.getEngine().getRenderingCanvas(), false);
        camera.wheelPrecision = 50;

        this._scene.activeCamera = camera;
        this._camera = camera;

        if (this._resourceManager) {
            const result = await this._resourceManager.loadAvatarAnimations(AvatarAnimationUrl);
            this._avatarAnimMesh = result.mesh;
            this._avatarAnimationGroups = result.animGroups;

            this._myAvatar = new GameObject("MyAvatar", this._scene);

            const mesh = await this._resourceManager.loadMyAvatar(DefaultAvatarUrl);
            mesh.rotationQuaternion = Quaternion.Zero();
            const meshComponent = new MeshComponent(mesh);
            this._myAvatar.addComponent(meshComponent);

            this._avatarController = new AvatarController();
            this._avatarController.animGroups = this._avatarAnimationGroups;

            this._myAvatar.addComponent(this._avatarController);

            this._myAvatar.addComponent(new MyAvatarController());
        }
    }


    private async _loadEnvironment(rootUrl:string,
        meshList:string[],
        incrementalMeshList:string[] | null | undefined) : Promise<void> {

        if (this._resourceManager) {
            this._resourceManager.addSceneObjectTasks("SceneLoading", rootUrl, meshList);
            await this._resourceManager.loadAsync();
            this._incrementalMeshList = incrementalMeshList;
            this._rootUrl = rootUrl;
        }
    }

    private _createScene() {
        this._scene = new Scene(this._engine);
        this._resourceManager = new ResourceManager(this._scene);
        this._scene.actionManager = new ActionManager(this._scene);
        this._scene.actionManager.registerAction(
            new ExecuteCodeAction(ActionManager.OnKeyUpTrigger,
                this._onKeyUp.bind(this))
        );

        this._scene.createDefaultCamera();

        const sceneController = new TransformNode("SceneController", this._scene);
    }

    private _onKeyUp(evt: ActionEvent) : void {
        // eslint-disable-next-line no-void
        void this._handleKeyUp(evt);
    }

    private async _handleKeyUp(evt: ActionEvent) :Promise<void> {
        /* eslint-disable @typescript-eslint/no-unsafe-member-access */
        switch (evt.sourceEvent.code) {
            case "Slash":
                if (process.env.NODE_ENV === "development"
                && evt.sourceEvent.shiftKey) {
                    if (this._scene.debugLayer.isVisible()) {
                        this._scene.debugLayer.hide();
                    } else {
                        await this._scene.debugLayer.show({ overlay: true });
                    }
                }
                break;
            case "Space":
                if (process.env.NODE_ENV === "development"
                    && evt.sourceEvent.shiftKey) {
                    await this.loadSceneSpaceStation();
                }
                break;
            case "KeyU":
                if (process.env.NODE_ENV === "development"
                        && evt.sourceEvent.shiftKey) {
                    await this.loadSceneUA92Campus();
                }
                break;
            default:
                break;
        }
    }

    private _handleActiveDomainStateChange(pDomain: Domain, pState: ConnectionState, pInfo: string): void {
        if (pState === ConnectionState.CONNECTED) {
            Log.debug(Log.types.AVATAR, `VScene._handleActiveDomainStateChange: CONNECTED`);

            const sessionID = pDomain.DomainClient?.sessionUUID;
            if (sessionID) {
                Log.debug(Log.types.AVATAR, `Session ID: ${sessionID.stringify()}`);
            }

            this._avatarMixer = pDomain.AvatarClient?.Mixer;
            const myAvatar = pDomain.AvatarClient?.MyAvatar;
            if (myAvatar) {
                if (myAvatar.skeletonModelURL === "") {
                    myAvatar.skeletonModelURL = DefaultAvatarUrl;
                }

                if (this._myAvatar) {
                    const myAvatarController = this._myAvatar.getComponent("MyAvatarController") as MyAvatarController;
                    myAvatarController.myAvatar = myAvatar;
                }
            }

            const avatarList = this._avatarMixer?.avatarList;
            if (avatarList) {
                avatarList.avatarAdded.connect(this._handleAvatarAdded.bind(this));
                avatarList.avatarRemoved.connect(this._handleAvatarRemoved.bind(this));

                const uuids = avatarList.getAvatarIDs();
                const emptyId = new Uuid();

                uuids.forEach((uuid) => {
                    // filter my avatar
                    if (uuid.stringify() !== emptyId.stringify()) {
                        this._handleAvatarAdded(uuid);
                    }
                });
            }

        } else if (pState === ConnectionState.DISCONNECTED) {
            Log.debug(Log.types.AVATAR, `VScene._handleActiveDomainStateChange: ${Domain.stateToString(pState)}`);

            this._avatarList.forEach((gameObj) => {
                gameObj.dispose();
            });
            this._avatarList.clear();

            if (this._myAvatar) {
                const myAvatarController = this._myAvatar.getComponent("MyAvatarController") as MyAvatarController;
                myAvatarController.myAvatar = null;
            }
        }
    }

    private _handleAvatarAdded(sessionID:Uuid): void {
        const avatarList = this._avatarMixer?.avatarList;
        if (avatarList) {
            Log.debug(Log.types.AVATAR,
                `VScene._handleAvatarAdded. Session ID: ${sessionID.stringify()}`);

            const domain = avatarList.getAvatar(sessionID);
            domain.skeletonModelURLChanged.connect(() => {
                this._handleAvatarSkeletonModelURLChanged(sessionID, domain);
            });
        }
    }

    private _handleAvatarRemoved(sessionID:Uuid): void {
        Log.debug(Log.types.AVATAR,
            `VScene._handleAvatarRemoved. Session ID: ${sessionID.stringify()}`);

        const domain = this._avatarMixer?.avatarList.getAvatar(sessionID);
        if (domain) {
            const avatar = this._avatarList.get(sessionID);
            if (avatar) {
                avatar.dispose();
                this._avatarList["delete"](sessionID);
            }
        }
    }

    private _handleAvatarSkeletonModelURLChanged(sessionID:Uuid, domain:ScriptAvatar): void {
        Log.debug(Log.types.AVATAR,
            `VScene._handleAvatarSkeletonModelURLChanged. Session ID: ${sessionID.stringify()}, ${domain.skeletonModelURL}`);

        const avatar = this._avatarList.get(sessionID);
        if (avatar) {
            avatar.dispose();
        }

        if (domain.skeletonModelURL !== "" && this._resourceManager) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._resourceManager.loadAvatar(domain.skeletonModelURL).then((mesh) => {
                const newAvatar = new GameObject("ScriptAvatar_" + sessionID.stringify(), this._scene);
                this._avatarList.set(sessionID, newAvatar);

                newAvatar.addComponent(new MeshComponent(mesh));
                newAvatar.addComponent(new ScriptAvatarController(domain));
            })
                ["catch"]((error) => {
                    Log.debug(Log.types.AVATAR,
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                        `fail to load mesh ${domain.skeletonModelURL} : ${error}`);
                });
        }
    }

    private _onSceneReady():void {
        requireScriptForNodes(this._scene, this._scene.transformNodes);

        // handle dynamic loaded script
        this._scene.onNewTransformNodeAddedObservable.add((node) => {
            if (node instanceof ScriptComponent) {
                this._scene.onBeforeRenderObservable.addOnce(() => {
                    requireScript(this._scene, node);

                });
            }
        });

        if (this._incrementalMeshList) {
            this._scene.onBeforeRenderObservable.addOnce(() => {
                this._resourceManager?.addSceneObjectTasks("SceneIncrementalLoading",
                    this._rootUrl, this._incrementalMeshList as string[]);
                // eslint-disable-next-line no-void
                void this._resourceManager?.loadAsync();

                this._incrementalMeshList = null;
            });
        }
    }
}
