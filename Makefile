SHELL=/bin/bash

.SECONDEXPANSION:

CURRENT_DIR := $(CURDIR)

PACKAGE?=
PACKAGE_NAME_OFFICIAL=youtube.leanback.v4
PACKAGE_NAME?=youtube.leanback.v4
PACKAGE_NAME_TARGET=$(PACKAGE_NAME)
PACKAGE_DISPLAY_NAME?=YouTube webOS Cobalt AdFree
PROJECT_VERSION?=1.0.0
PACKAGE_COBALT_VERSION?=23.lts.4
PACKAGE_VERSION?=$(PROJECT_VERSION)
PACKAGE_IPK_BUILD=$(PACKAGE_NAME_TARGET)_$(PACKAGE_VERSION)_arm.ipk
PACKAGE_OUTPUT_DIR?=output
PACKAGE_TARGET?=$(PACKAGE_OUTPUT_DIR)/$(PACKAGE_IPK_BUILD)
PACKAGE_SB_API_VERSION?=$(shell strings $(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/cobalt | grep sb_api | jq -r '.sb_api_version' | grep -v null || strings $(WORKDIR)/package/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/cobalt | grep sb_api | jq -r '.sb_api_version' | grep -v null)
YTAF_DEBUG?=0
YTAF_DEBUG_ENABLED=$(filter 1 true yes on,$(YTAF_DEBUG))
COBALT_DEBUG?=$(YTAF_DEBUG)
COBALT_DEBUG_ENABLED=$(filter 1 true yes on,$(COBALT_DEBUG))
COBALT_DEBUG_SUFFIX=$(if $(COBALT_DEBUG_ENABLED),-logging,)
COBALT_DEBUG_GN_ARG=$(if $(COBALT_DEBUG_ENABLED),true,false)
PACKAGE_COBALT_ARCHIVE?=cobalt-bin/$(PACKAGE_COBALT_VERSION)-$(PACKAGE_SB_API_VERSION)$(COBALT_DEBUG_SUFFIX).xz
OFFICAL_YOUTUBE_IPK?=ipks-official/2023-07-30-youtube.leanback.v4-1.1.7.ipk

WORKDIR?=workdir
WORKDIR_COBALT?=$(WORKDIR)/cobalt-$(BUILD_COBALT_VERSION)

BUILD_VERSION?=
BUILD_COBALT_PARALLEL?=
BUILD_COBALT_TYPE?=gold
BUILD_COBALT_VERSION=$(word 1, $(subst -, ,$(BUILD_VERSION)))
BUILD_COBALT_SB_API_VERSION=$(word 2, $(subst -, ,$(BUILD_VERSION)))
BUILD_COBALT_DEBUG?=$(if $(filter logging,$(word 3, $(subst -, ,$(BUILD_VERSION)))),1,$(COBALT_DEBUG))
BUILD_COBALT_DEBUG_ENABLED=$(filter 1 true yes on,$(BUILD_COBALT_DEBUG))
BUILD_COBALT_DEBUG_GN_ARG=$(if $(BUILD_COBALT_DEBUG_ENABLED),true,false)
BUILD_COBALT_ARCHITECTURE?=arm-softfp
BUILD_COBALT_PLATFORM?=evergreen-$(BUILD_COBALT_ARCHITECTURE)
BUILD_COBALT_TARGET?=cobalt
BUILD_COBALT_YOUTUBE_APP_FILES_RULES=$(foreach file,$(WEBOS_YOUTUBE_APP_FILES),$(WORKDIR_COBALT)/cobalt/adblock/content/$(file))
WEBAPP_OUTPUT_DIR?=webapp/output
WEBAPP_DEBUG?=$(YTAF_DEBUG)
WEBAPP_OUTPUT_STAMP=webapp/.build-stamp.$(WEBAPP_DEBUG)
NODE_DOCKER_IMAGE?=node:22

WEBOS_YOUTUBE_APP_FILES?=adblockMain.js adblockMain.css

STANDALONE_APP_ID?=com.cobalt.youtube.launcher
STANDALONE_DISPLAY_NAME?=YouTube Cobalt
STANDALONE_VERSION?=$(PROJECT_VERSION)
STANDALONE_COBALT_VERSION?=7.1.2-arm-softfp-sb18
STANDALONE_COBALT_DIR?=cobalt-bin/$(STANDALONE_COBALT_VERSION)
STANDALONE_YOUTUBE_URL?=https://www.youtube.com/tv?launch=menu
STANDALONE_WORKDIR?=$(WORKDIR)/standalone
STANDALONE_OUTPUT_DIR?=$(PACKAGE_OUTPUT_DIR)
STANDALONE_PACKAGE?=$(STANDALONE_OUTPUT_DIR)/$(STANDALONE_APP_ID)_$(STANDALONE_VERSION)_arm.ipk
STANDALONE_POC_COBALT_VERSION?=23.lts.4-12
STANDALONE_POC_RUNTIME_SOURCE?=cobalt-bin/$(STANDALONE_POC_COBALT_VERSION)
STANDALONE_POC_COBALT_DIR?=$(WORKDIR)/standalone-poc-cobalt/$(STANDALONE_POC_COBALT_VERSION)
STANDALONE_POC_STARTER_SOURCE?=workdir/ipk/cobalt


.PHONY: all
all: package ;

.PHONY: help
help:
	@echo "To patch your ipk, use:"
	@echo "  make PACKAGE=./my-tv-youtube-application.ipk"
	@echo ""
	@echo "To build the standalone Cobalt launcher, use:"
	@echo "  make standalone-package"
	@echo "To build the proof-of-concept app with the extracted webOS starter, use:"
	@echo "  make standalone-poc-package"
	@echo "To check the standalone runtime files, use:"
	@echo "  make standalone-runtime-status"
	@echo ""
	@echo "By default it creates a separate app:"
	@echo "  id:   $(PACKAGE_NAME_TARGET)"
	@echo "  name: $(PACKAGE_DISPLAY_NAME)"
	@echo ""
	@echo "To overwrite the official YouTube app instead, pass:"
	@echo "  PACKAGE_NAME=$(PACKAGE_NAME_OFFICIAL)"
	@echo ""

.PHONY: ares-install
ares-install:
	aresCmd=$$(command -v ares-install); \
	if [ "$$aresCmd" == "" ]; then \
		npmCmd=$$(command -v npm); \
		if [ "$$npmCmd" == "" ]; then \
			echo "\"npm\" is required to install ares-cli"; \
		fi; \
		npm install @webosose/ares-cli; \
		aresCmd=node_modules/.bin/ares-install; \
	fi; \
	$$aresCmd ./output/$(shell ls --sort=time output | head -n 1)

.PHONY: check-package
check-package:
	@test ! -z "$(PACKAGE)" || (echo "\"make PACKAGE=./my-tv-youtube-application.ipk\" is required" && echo "--" && echo "" && $(MAKE) help && exit 1)
	@test -f $(PACKAGE) || (echo "File \"$(PACKAGE)\" does not exist" && echo "--" && echo "" && exit 1)
	@echo ""

.PHONY: package
package: check-package
	$(MAKE) clean-ipk
	$(MAKE) $(PACKAGE_TARGET)

.PHONY: clean-ipk
clean-ipk:
	rm -fr $(WORKDIR)/cobalt $(WORKDIR)/unpacked_ipk $(WORKDIR)/package $(WORKDIR)/image $(WORKDIR)/ipk $(WORKDIR)/ipk-output

.PHONY: clean-standalone
clean-standalone:
	rm -fr $(STANDALONE_WORKDIR) $(WORKDIR)/standalone-output

.PHONY: standalone-package
standalone-package:
	$(MAKE) clean-standalone
	$(MAKE) $(STANDALONE_PACKAGE)

.PHONY: standalone-poc-starter
standalone-poc-starter:
	@test -f "$(STANDALONE_POC_STARTER_SOURCE)" || (echo "" && echo "--" && echo "Missing POC starter source: $(STANDALONE_POC_STARTER_SOURCE)" && echo "Build or unpack the compatibility source package first." && exit 1)
	@test -d "$(STANDALONE_POC_RUNTIME_SOURCE)" || (echo "" && echo "--" && echo "Missing POC runtime source: $(STANDALONE_POC_RUNTIME_SOURCE)" && exit 1)
	rm -rf "$(STANDALONE_POC_COBALT_DIR)"
	mkdir -p "$(dir $(STANDALONE_POC_COBALT_DIR))"
	cp -R "$(STANDALONE_POC_RUNTIME_SOURCE)" "$(STANDALONE_POC_COBALT_DIR)"
	cp "$(STANDALONE_POC_STARTER_SOURCE)" "$(STANDALONE_POC_COBALT_DIR)/cobalt"
	chmod +x "$(STANDALONE_POC_COBALT_DIR)/cobalt"
	@echo "POC runtime prepared in:"
	@echo "  $(STANDALONE_POC_COBALT_DIR)"
	@echo ""
	@echo "This is only for the compatibility proof of concept."

.PHONY: standalone-poc-runtime-status
standalone-poc-runtime-status: standalone-poc-starter
	$(MAKE) standalone-runtime-status STANDALONE_COBALT_DIR="$(STANDALONE_POC_COBALT_DIR)"

.PHONY: standalone-poc-package
standalone-poc-package: standalone-poc-starter
	$(MAKE) standalone-package STANDALONE_COBALT_DIR="$(STANDALONE_POC_COBALT_DIR)"

.PHONY: standalone-runtime-status
standalone-runtime-status:
	@echo "Standalone runtime directory:"
	@echo "  $(STANDALONE_COBALT_DIR)"
	@echo ""
	@if [ -f "$(STANDALONE_COBALT_DIR)/cobalt" ]; then \
		echo "OK  cobalt executable"; \
	else \
		echo "MISS cobalt executable: $(STANDALONE_COBALT_DIR)/cobalt"; \
	fi
	@if [ -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.lz4" ]; then \
		echo "OK  compressed Cobalt library: lib/libcobalt.lz4"; \
	elif [ -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.so" ]; then \
		echo "OK  Cobalt library: lib/libcobalt.so"; \
	elif [ -f "$(STANDALONE_COBALT_DIR)/libcobalt.so" ]; then \
		echo "OK  Cobalt library: libcobalt.so"; \
	else \
		echo "MISS Cobalt library"; \
	fi
	@if [ -d "$(STANDALONE_COBALT_DIR)/content" ]; then \
		echo "OK  content directory"; \
	else \
		echo "MISS content directory: $(STANDALONE_COBALT_DIR)/content"; \
	fi
	@echo ""
	@echo "When all entries are OK, run:"
	@echo "  make standalone-package"

$(STANDALONE_WORKDIR):
	@test -f "$(STANDALONE_COBALT_DIR)/cobalt" || (echo "" && echo "--" && echo "Standalone packaging needs a Cobalt executable at $(STANDALONE_COBALT_DIR)/cobalt." && echo "The old patch archives usually only include libcobalt.so, because they reused the official YouTube starter." && echo "Build or place a free Cobalt runtime there before running this target." && exit 1)
	@test -f "$(STANDALONE_COBALT_DIR)/libcobalt.so" || test -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.so" || test -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.lz4" || (echo "" && echo "--" && echo "Missing libcobalt runtime in $(STANDALONE_COBALT_DIR)" && exit 1)
	mkdir -p $@/content/app/cobalt/lib $@/content/app/cobalt/content/web/youtube $@/content/web/youtube
	cp "$(STANDALONE_COBALT_DIR)/cobalt" $@/cobalt
	if [ -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.lz4" ]; then \
		cp "$(STANDALONE_COBALT_DIR)/lib/libcobalt.lz4" $@/content/app/cobalt/lib/libcobalt.lz4; \
	elif [ -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.so" ]; then \
		cp "$(STANDALONE_COBALT_DIR)/lib/libcobalt.so" $@/content/app/cobalt/lib/libcobalt.so; \
	else \
		cp "$(STANDALONE_COBALT_DIR)/libcobalt.so" $@/content/app/cobalt/lib/libcobalt.so; \
	fi
	cp -r "$(STANDALONE_COBALT_DIR)/content/." $@/content/app/cobalt/content/
	cp standalone/splash.html $@/content/app/cobalt/content/web/youtube/splash.html
	cp standalone/splash.html $@/content/web/youtube/splash.html
	cp assets/icon.png $@/icon.png
	cp assets/mediumLargeIcon.png $@/mediumLargeIcon.png
	cp assets/largeIcon.png $@/largeIcon.png
	cp assets/extraLargeIcon.png $@/extraLargeIcon.png
	cp assets/bgImage.png $@/bgImage.png
	cp assets/splashBackground.png $@/splashBackground.png
	cp assets/imageForRecents.png $@/imageForRecents.png
	cp assets/playIcon.png $@/playIcon.png
	printf '%s\n' \
	  '{"id":"$(STANDALONE_APP_ID)",' \
	  '"version":"$(STANDALONE_VERSION)",' \
	  '"vendor":"RF1705",' \
	  '"type":"native",' \
	  '"main":"cobalt",' \
	  '"title":"$(STANDALONE_DISPLAY_NAME)",' \
	  '"icon":"icon.png",' \
	  '"largeIcon":"largeIcon.png",' \
	  '"mediumLargeIcon":"mediumLargeIcon.png",' \
	  '"extraLargeIcon":"extraLargeIcon.png",' \
	  '"bgImage":"bgImage.png",' \
	  '"splashBackground":"splashBackground.png",' \
	  '"imageForRecents":"imageForRecents.png",' \
	  '"playIcon":"playIcon.png",' \
	  '"iconColor":"#ff0000",' \
	  '"resolution":"1920x1080",' \
	  '"vendorExtension":{"userAgent":"$$browserName$$/$$browserVersion$$ ($$platformName$$-$$platformVersion$$), _TV_O18/$$firmwareVersion$$ (LG, $$modelName$$, $$networkMode$$)","allowCrossDomain":true},' \
	  '"support360Content":true,' \
	  '"trustLevel":"netcast",' \
	  '"privilegedJail":true,' \
	  '"supportGIP":true,' \
	  '"uiRevision":2,' \
	  '"nativeLifeCycleInterfaceVersion":2,' \
	  '"supportQuickStart":true,' \
	  '"enablePigScreenSaver":false}' > $@/appinfo.json
	printf '%s\n' \
	  '--webos_extra_web_file_dir=/usr/share/javascript/' \
	  '--url=$(STANDALONE_YOUTUBE_URL)' \
	  '--retain_remote_typeface_cache_during_suspend' \
	  '--fallback_splash_screen_url=file:///youtube/splash.html' \
	  '--min_log_level=info' \
	  '--enable_pseudo_touch' \
	  '--loader_use_mmap_file' > $@/switches
	if [ -f "$(STANDALONE_COBALT_DIR)/lib/libcobalt.lz4" ]; then \
		printf '%s\n' '--loader_use_compression' >> $@/switches; \
	fi
	printf '%s\n' \
	  '{"manifest_version":2,"name":"Cobalt","description":"Standalone Cobalt YouTube launcher","version":"$(STANDALONE_VERSION)"}' > $@/content/app/cobalt/manifest.json

$(STANDALONE_PACKAGE): FORCE $(STANDALONE_WORKDIR)
	@aresCmd=$$(command -v ares-package); \
	if [ "$$aresCmd" == "" ]; then \
		npmCmd=$$(command -v npm); \
		if [ "$$npmCmd" == "" ]; then \
			echo "\"npm\" is required to install ares-cli"; \
			exit 1; \
		fi; \
		npm install @webosose/ares-cli; \
		aresCmd=node_modules/.bin/ares-package; \
	fi; \
	mkdir -p $(STANDALONE_OUTPUT_DIR) $(WORKDIR)/standalone-output; \
	$$aresCmd -v --outdir $(WORKDIR)/standalone-output $(STANDALONE_WORKDIR)
	mv $(WORKDIR)/standalone-output/$(STANDALONE_APP_ID)_$(STANDALONE_VERSION)_arm.ipk $@
	@echo "Standalone package can be installed with:"
	@echo "  ares-install $(STANDALONE_PACKAGE)"

.PRECIOUS: $(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/cobalt
$(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/cobalt:
	mkdir -p $(WORKDIR)/unpacked_ipk $(WORKDIR)/package $(WORKDIR)/image
	if [[ "$(PACKAGE)" == *.tar.gz || "$(PACKAGE)" == *.tgz ]]; then \
		mkdir -p $(WORKDIR)/package/usr/palm/applications; \
		tar xzpf $(PACKAGE) -C $(WORKDIR)/package/usr/palm/applications; \
	else \
		tar -xf $(PACKAGE) -C $(WORKDIR)/unpacked_ipk || (cd $(WORKDIR)/unpacked_ipk && ar x $(abspath $(PACKAGE))); \
		tar xvzpf $(WORKDIR)/unpacked_ipk/control.tar.gz -C $(WORKDIR)/unpacked_ipk; \
		tar xvzpf $(WORKDIR)/unpacked_ipk/data.tar.gz -C $(WORKDIR)/package; \
		if [ -f $(WORKDIR)/package/usr/palm/data/images/$(PACKAGE_NAME_OFFICIAL)/data.img ]; then \
			unsquashfs -f -d $(WORKDIR)/image $(WORKDIR)/package/usr/palm/data/images/$(PACKAGE_NAME_OFFICIAL)/data.img; \
		fi; \
	fi

.PRECIOUS: $(WORKDIR)/cobalt
$(WORKDIR)/cobalt:
	mkdir -p $@
	@! test -z $(PACKAGE_SB_API_VERSION) || (echo "" && echo "--" && echo "Cannot find SB_API_VERSION in IPK binary. You can try to specify it with: make PACKAGE_SB_API_VERSION=12" && exit 1)
	tar -xJvf $(PACKAGE_COBALT_ARCHIVE) -C $@

.PRECIOUS: $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock
$(WORKDIR)/ipk/content/app/cobalt/content/web/adblock: $(WEBAPP_OUTPUT_STAMP)

	mkdir -p $(WORKDIR)/ipk
	cp -r $(WORKDIR)/package/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/* $(WORKDIR)/ipk
	if [ -d $(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL) ]; then \
		cp -r $(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/* $(WORKDIR)/ipk; \
	fi

	rm -f $(WORKDIR)/ipk/drm.nfz
	sed -i.bak 's/YouTube/$(PACKAGE_DISPLAY_NAME)/g' $(WORKDIR)/ipk/appinfo.json
	rm -f $(WORKDIR)/ipk/appinfo.json.bak
	jq --arg version "$(PACKAGE_VERSION)" 'del(.fileSystemType) | .version = $$version | .iconColor = "#ff0000" | .vendorExtension.userAgent = "$$browserName$$/$$browserVersion$$ ($$platformName$$-$$platformVersion$$), _TV_O18/$$firmwareVersion$$ (LG, $$modelName$$, $$networkMode$$)" | .vendorExtension.allowCrossDomain = true | .support360Content = true | .trustLevel = "netcast" | .privilegedJail = true | .supportGIP = true' < $(WORKDIR)/ipk/appinfo.json > $(WORKDIR)/ipk/appinfo2.json
	mv $(WORKDIR)/ipk/appinfo2.json $(WORKDIR)/ipk/appinfo.json

	cp assets/icon.png $(WORKDIR)/ipk/$$(jq -r '.icon' < $(WORKDIR)/ipk/appinfo.json)
	cp assets/mediumLargeIcon.png $(WORKDIR)/ipk/$$(jq -r '.mediumLargeIcon' < $(WORKDIR)/ipk/appinfo.json)
	cp assets/largeIcon.png $(WORKDIR)/ipk/$$(jq -r '.largeIcon' < $(WORKDIR)/ipk/appinfo.json)
	cp assets/extraLargeIcon.png $(WORKDIR)/ipk/$$(jq -r '.extraLargeIcon' < $(WORKDIR)/ipk/appinfo.json)
	cp assets/playIcon.png $(WORKDIR)/ipk/$$(jq -r '.playIcon' < $(WORKDIR)/ipk/appinfo.json)
	cp assets/imageForRecents.png $(WORKDIR)/ipk/$$(jq -r '.imageForRecents' < $(WORKDIR)/ipk/appinfo.json)

	echo " --evergreen_lite" >> $(WORKDIR)/ipk/switches
	if [ -n "$(COBALT_DEBUG_ENABLED)" ]; then \
		echo " --remote_debugging_port=9222" >> $(WORKDIR)/ipk/switches; \
		echo " --dev_servers_listen_ip=0.0.0.0" >> $(WORKDIR)/ipk/switches; \
	fi

ifneq ("$(PACKAGE_NAME_TARGET)","$(PACKAGE_NAME_OFFICIAL)")
	grep -l -R "$(PACKAGE_NAME_OFFICIAL)" $(WORKDIR)/ipk | grep .json | xargs -n 1 sed -i.bak "s/$(PACKAGE_NAME_OFFICIAL)/$(PACKAGE_NAME_TARGET)/g"
	find $(WORKDIR)/ipk -name '*.bak' -delete
endif

	libcobalt=$$(find $(WORKDIR)/ipk -name libcobalt.so); \
	! test -z "$$libcobalt" || (echo "" && echo "--" && echo "File \"libcobalt.so\" is not present in your IPK. This patch is not compatible with your IPK version." && exit 1) && \
	cp $(WORKDIR)/cobalt/libcobalt.so $$libcobalt
	cp -r $(WORKDIR)/cobalt/content $(WORKDIR)/ipk/content/app/cobalt
	mkdir -p $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock
	mkdir -p $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock
	if command -v rsync >/dev/null 2>&1; then \
		rsync -a --delete $(WEBAPP_OUTPUT_DIR)/ $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock/; \
	else \
		rm -rf $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock/*; \
		cp -r $(WEBAPP_OUTPUT_DIR)/. $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock/; \
	fi

.PHONY: ares-package
ares-package:
	@aresCmd=$$(command -v ares-package); \
	if [ "$$aresCmd" == "" ]; then \
		npmCmd=$$(command -v npm); \
		if [ "$$npmCmd" == "" ]; then \
			echo "\"npm\" is required to install ares-cli"; \
		fi; \
		npm install @webosose/ares-cli; \
		aresCmd=node_modules/.bin/ares-package; \
	fi; \
	$$aresCmd -v -c $(WORKDIR)/ipk; \
	$$aresCmd -v --outdir $(WORKDIR)/ipk-output $(WORKDIR)/ipk

.PHONY: ares-package-docker
ares-package-docker: docker-make.ares-package
	@echo ""

.PRECIOUS: $(PACKAGE_TARGET)
$(PACKAGE_TARGET): FORCE $(WORKDIR)/image/usr/palm/applications/$(PACKAGE_NAME_OFFICIAL)/cobalt $(WORKDIR)/cobalt $(WORKDIR)/ipk/content/app/cobalt/content/web/adblock ares-package-docker
	mkdir -p $(dir $@)
	mv $(WORKDIR)/ipk-output/$(PACKAGE_IPK_BUILD) $@
	@echo "Package can be installed with:"
	@echo "  ares-install $(PACKAGE_TARGET)"
	@echo "  or"
	@echo "  $(MAKE) ares-install"



# Part to build the injected adblock web app
# Example of usage
# make cobalt-bin/23.lts.4-12/libcobalt.so:

.PHONY: docker-make.%
docker-make.%:
	docker run --rm -i -u $$(id -u):$$(id -g) -e HOME=/app -e npm_config_cache=/app/.npm -e WEBAPP_DEBUG="$(WEBAPP_DEBUG)" -v "$$PWD:/app" -w /app $(NODE_DOCKER_IMAGE) sh -lc 'mkdir -p /app/.webos /app/.npm && make $*'
.PHONY: npm
npm:
	( \
		cd webapp && \
		npm install && \
		YTAF_DEBUG="$(WEBAPP_DEBUG)" npm run build -- --env production --optimization-minimize \
	)

$(WEBAPP_OUTPUT_STAMP): $(shell find webapp/src -type f) webapp/package.json webapp/webpack.config.js
	$(MAKE) docker-make.npm
	rm -f webapp/.build-stamp.*
	touch $@

.PHONY: npm-docker
npm-docker: docker-make.npm
	@echo ""

# Part to build cobalt
# Example of usage
# make cobalt-bin/23.lts.4-12/libcobalt.so
# make cobalt-bin/23.lts.4-12-x64x11/cobalt

clean-$(WORKDIR)/cobalt-%:
	cd $(WORKDIR)/cobalt-$* && git checkout . && git clean -d -f

cobalt-bin:
	mkdir -p cobalt-bin

.PRECIOUS: cobalt-bin/libcobalt-%/libcobalt.so
cobalt-bin/%/libcobalt.so: BUILD_VERSION=$*
cobalt-bin/%/libcobalt.so: cobalt-bin $(WEBAPP_OUTPUT_STAMP)
	if [ ! -d "$(WORKDIR_COBALT)/.git" ]; then \
		git clone --depth 1 --branch $(BUILD_COBALT_VERSION) https://github.com/youtube/cobalt.git $(WORKDIR_COBALT); \
	fi
	if [ ! -f "$(WORKDIR_COBALT)/.patched" ]; then \
		(cd $(WORKDIR_COBALT) && git apply --recount "$(CURRENT_DIR)/cobalt-patches/cobalt-$(BUILD_COBALT_VERSION).patch" && touch .patched) || (echo "Missing or invalid patch for version $(BUILD_COBALT_VERSION)" && exit 1); \
	fi
	perl -0pi -e 's/^(\s*)<<: \*common-definitions\n\1<<: \*build-volumes/$$1<<: [*common-definitions, *build-volumes]/mg' $(WORKDIR_COBALT)/docker-compose.yml
	grep -q 'archive.debian.org/debian-security' "$(WORKDIR_COBALT)/docker/linux/base/Dockerfile" || \
		perl -0pi -e 's{ENV PYTHONUNBUFFERED 1\n}{ENV PYTHONUNBUFFERED 1\n\nRUN sed -i -e "s|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|" -e "s|http://deb.debian.org/debian|http://archive.debian.org/debian|" -e "s|http://httpredir.debian.org/debian|http://archive.debian.org/debian|" -e "s|deb http://archive.debian.org/debian buster-updates|# deb http://archive.debian.org/debian buster-updates|" -e "s|deb http://archive.debian.org/debian stretch-updates|# deb http://archive.debian.org/debian stretch-updates|" /etc/apt/sources.list && printf "%s\\n" "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99archive\n}' "$(WORKDIR_COBALT)/docker/linux/base/Dockerfile"
	perl -0pi -e 's/&& \. \/tmp\/install\.sh/&& bash \/tmp\/install.sh/g; s/nvm install --lts/nvm install 16/g; s/nvm alias default lts\/\*/nvm alias default 16\/*/g' $(WORKDIR_COBALT)/docker/linux/base/build/Dockerfile
	grep -q 'ytaf_debug' "$(WORKDIR_COBALT)/starboard/build/config/BUILD.gn" || \
		perl -0pi -e 's{import\("//build/config/compiler/compiler.gni"\)\n}{import("//build/config/compiler/compiler.gni")\n\ndeclare_args() {\n  ytaf_debug = false\n}\n}' "$(WORKDIR_COBALT)/starboard/build/config/BUILD.gn"
	grep -q 'YTAF_COBALT_DEBUG' "$(WORKDIR_COBALT)/starboard/build/config/BUILD.gn" || \
		perl -0pi -e 's{(\s*if \(enable_in_app_dial\) \{\n\s*defines \+= \[ "DIAL_SERVER" \]\n\s*\}\n)}{$$1\n  if (ytaf_debug) {\n    defines += [ "YTAF_COBALT_DEBUG" ]\n  }\n}' "$(WORKDIR_COBALT)/starboard/build/config/BUILD.gn"
	perl -0pi -e 's{sb_api_version=\$\{SB_API_VERSION:-14\}(?! ytaf_debug)}{sb_api_version=$${SB_API_VERSION:-14} ytaf_debug=$${YTAF_COBALT_DEBUG:-false}}g' "$(WORKDIR_COBALT)/docker/linux/evergreen/Dockerfile" "$(WORKDIR_COBALT)/docker/linux/linux-x64x11/Dockerfile"
	mkdir -p $(WORKDIR_COBALT)/cobalt/adblock/content
	cp -r $(WEBAPP_OUTPUT_DIR)/. $(WORKDIR_COBALT)/cobalt/adblock/content/
	cd $(WORKDIR_COBALT) && \
	DOCKER_DEFAULT_PLATFORM=linux/amd64 docker-compose run $(if $(BUILD_COBALT_PARALLEL),-e NINJA_PARALLEL=$(BUILD_COBALT_PARALLEL),) -e CONFIG="$(BUILD_COBALT_TYPE)" -e TARGET="$(BUILD_COBALT_TARGET)" -e SB_API_VERSION="$(BUILD_COBALT_SB_API_VERSION)" -e YTAF_COBALT_DEBUG="$(BUILD_COBALT_DEBUG_GN_ARG)" $(BUILD_COBALT_PLATFORM)
	mkdir -p $(dir $@)
	outdir="$(WORKDIR_COBALT)/out/$(BUILD_COBALT_PLATFORM)-sbversion-$(BUILD_COBALT_SB_API_VERSION)_$(BUILD_COBALT_TYPE)"; \
	if [ ! -d "$$outdir" ]; then \
		outdir="$(WORKDIR_COBALT)/out/$(BUILD_COBALT_PLATFORM)_$(BUILD_COBALT_TYPE)"; \
	fi; \
	cp -r "$$outdir/content" $(dir $@); \
	if [ -f "$$outdir/cobalt" ]; then \
		cp "$$outdir/cobalt" $(dir $@); \
	fi; \
	if [ -f "$$outdir/lib/libcobalt.so" ]; then \
		cp "$$outdir/lib/libcobalt.so" $@; \
	fi; \
	if [ -f "$$outdir/libcobalt.so" ]; then \
		cp "$$outdir/libcobalt.so" $@; \
	fi; \
	if [ "$(BUILD_COBALT_TYPE)" = "devel" ] && [ -f "$@" ]; then \
		docker run --rm -v "$$PWD:/work" -w /work cobalt-build-evergreen:latest sh -lc 'arm-linux-gnueabi-strip --strip-debug "$$1"' sh "$@"; \
	fi

cobalt-bin/%.xz:
	XZ_OPT="-9" tar -C $(basename $@) -cJvf $@ .

cobalt-bin/%-x64x11/cobalt: BUILD_VERSION=$*
cobalt-bin/%-x64x11/cobalt: BUILD_COBALT_PLATFORM=linux-x64x11
cobalt-bin/%-x64x11/cobalt: cobalt-bin/libcobalt-%-linux-x64x11/libcobalt.so ;

.PHONY: FORCE
FORCE: ;
