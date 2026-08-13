import { ConversionManager } from "./manager";
import { FreecadConverter } from "./adapters/freecad-converter";
import { Obj2GltfConverter } from "./adapters/obj2gltf-converter";
import { Fbx2GltfConverter } from "./adapters/fbx2gltf-converter";
import { AssimpConverter } from "./adapters/assimp-converter";
import { SldprtConverter } from "./adapters/sldprt-converter";
import type { ModelConverter } from "./types";
import { createLogger } from "../../utils/log";

const log = createLogger("conversion-factory");

export interface ConversionFactoryOptions {
  enabledConverterIds?: readonly string[];
  freecadCommand?: string;
  obj2gltfCommand?: string;
  fbx2gltfCommand?: string;
  assimpCommand?: string;
  freecadcmdCommand?: string;
  /**
   * Additional converters to register unconditionally (they are provided
   * explicitly, so they are not gated by `enabledConverterIds`). Use this to
   * extend the conversion pipeline at runtime without editing the built-in list.
   */
  extraConverters?: readonly ModelConverter[];
}

export function createConversionManager(options?: ConversionFactoryOptions): ConversionManager {
  const manager = new ConversionManager();

  // Built-ins are opt-in so Phase 3 keeps runtime behavior unchanged.
  const enabled = new Set(options?.enabledConverterIds ?? []);
  log.debug("create conversion manager", { enabledConverterIds: [...enabled] });
  const builtins = [
    new FreecadConverter(options?.freecadCommand),
    new Obj2GltfConverter(options?.obj2gltfCommand),
    new Fbx2GltfConverter(options?.fbx2gltfCommand),
    new AssimpConverter(options?.assimpCommand),
    new SldprtConverter(options?.freecadcmdCommand),
  ];

  for (const converter of builtins) {
    if (enabled.has(converter.id)) {
      manager.registerConverter(converter);
      log.info("enabled converter", { converterId: converter.id });
    } else {
      log.debug("converter disabled", { converterId: converter.id });
    }
  }

  for (const converter of options?.extraConverters ?? []) {
    manager.registerConverter(converter);
    log.info("registered custom converter", { converterId: converter.id });
  }

  return manager;
}
