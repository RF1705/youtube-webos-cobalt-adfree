#ifndef STARBOARD_WEBOS_ARM_STARFISH_AV_COMPONENTS_H_
#define STARBOARD_WEBOS_ARM_STARFISH_AV_COMPONENTS_H_

#include "starboard/shared/starboard/player/filter/player_components.h"

namespace starboard {
namespace shared {
namespace webos {

// false: codec/configuration unsupported or rollback selected; use the existing
// factory. true: shared path selected; a null result means an initialization
// failure, NOT permission to start a competing native pipeline. Eligible WebM
// Opus streams use this backend by default; YTAF_SHARED_AV=0 or a '0' in
// /tmp/ytaf-shared-av.enable rolls back to the existing backend after restart.
bool TryCreateStarfishAvComponents(
    const ::starboard::shared::starboard::player::filter::PlayerComponents::
        Factory::CreationParameters& parameters,
    scoped_ptr<::starboard::shared::starboard::player::filter::PlayerComponents>*
        components,
    std::string* error_message);

}  // namespace webos
}  // namespace shared
}  // namespace starboard
#endif
