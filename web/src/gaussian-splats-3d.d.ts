/*
 * 2026-04-05 | 新增 | GaussianSplats3D 本地类型声明
 * 功能描述：为当前 web/ 子工程使用到的第三方 API 提供最小但严格的 TypeScript 声明，覆盖 SceneFormat、DropInViewer、Viewer 与各类文件 loader。
 * 设计思路：第三方包当前未提供完整声明文件，因此仅声明本项目实际依赖的公共能力，既保证类型检查可运行，又避免向工程引入 `any`。
 * 参数与返回值：当前模块不接受外部参数；返回值为 TypeScript 编译期可见的模块声明。
 * 影响范围：仅影响 web/ 子工程的类型系统；上游为 TS 编译器，下游为 App 与 SplatViewer 的导入类型推断。
 * 潜在风险：若第三方库后续 API 发生变化，本地声明需要同步维护，否则可能出现“类型正确但运行不兼容”的偏差。
 */
declare module '@mkkellogg/gaussian-splats-3d' {
  import { Group } from 'three';

  export const SceneFormat: {
    readonly Splat: 0;
    readonly KSplat: 1;
    readonly Ply: 2;
    readonly Spz: 3;
  };

  export type SceneFormatValue = (typeof SceneFormat)[keyof typeof SceneFormat];
  export type SplatBuffer = unknown;

  export type SplatBufferOptions = {
    rotation?: [number, number, number, number];
    position?: [number, number, number];
    scale?: [number, number, number];
    splatAlphaRemovalThreshold?: number;
  };

  export type AddSplatSceneOptions = SplatBufferOptions & {
    format?: SceneFormatValue;
    showLoadingUI?: boolean;
    headers?: Record<string, string>;
    onProgress?: (percentComplete: number, percentCompleteLabel: string, loaderStatus: unknown) => void;
  };

  export class Viewer {
    addSplatBuffers(
      splatBuffers: SplatBuffer[],
      splatBufferOptions?: SplatBufferOptions[],
      finalBuild?: boolean,
      showLoadingUI?: boolean,
      showLoadingUIForSplatTreeBuild?: boolean,
      replaceExisting?: boolean,
      preserveVisibleRegion?: boolean,
    ): Promise<void>;
  }

  export class DropInViewer extends Group {
    viewer: Viewer;

    constructor(options?: {
      gpuAcceleratedSort?: boolean;
      sharedMemoryForWorkers?: boolean;
    });

    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<void>;
    removeSplatScene(index: number, showLoadingUI?: boolean): Promise<void>;
    getSceneCount(): number;
    dispose(): Promise<void>;
  }

  export class PlyLoader {
    static loadFromFileData(
      fileData: ArrayBuffer,
      minimumAlpha?: number,
      compressionLevel?: number,
      optimizeSplatData?: boolean,
      outSphericalHarmonicsDegree?: number,
      sectionSize?: number,
      sceneCenter?: [number, number, number],
      blockSize?: number,
      bucketSize?: number,
    ): Promise<SplatBuffer>;
  }

  export class SplatLoader {
    static loadFromFileData(
      fileData: ArrayBuffer,
      minimumAlpha?: number,
      compressionLevel?: number,
      optimizeSplatData?: boolean,
      sectionSize?: number,
      sceneCenter?: [number, number, number],
      blockSize?: number,
      bucketSize?: number,
    ): Promise<SplatBuffer>;
  }

  export class KSplatLoader {
    static loadFromFileData(fileData: ArrayBuffer): Promise<SplatBuffer>;
  }

  export class SpzLoader {
    static loadFromFileData(
      fileData: ArrayBuffer,
      minimumAlpha?: number,
      compressionLevel?: number,
      optimizeSplatData?: boolean,
      outSphericalHarmonicsDegree?: number,
      sectionSize?: number,
      sceneCenter?: [number, number, number],
      blockSize?: number,
      bucketSize?: number,
    ): Promise<SplatBuffer>;
  }
}
