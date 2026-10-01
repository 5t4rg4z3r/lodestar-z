import {createChainForkConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {networksChainConfig} from "@lodestar/config/networks";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {createStfState, stfConfig} from "./stfFixture.js";

describe("BeaconConfig", () => {
  describe.each([
    {field: "FULU_FORK_EPOCH", override: (value: number) => ({FULU_FORK_EPOCH: value})},
    {
      field: "BLOB_SCHEDULE.EPOCH",
      override: (value: number) => ({BLOB_SCHEDULE: [{EPOCH: value, MAX_BLOBS_PER_BLOCK: 9}]}),
    },
    {
      field: "BLOB_SCHEDULE.MAX_BLOBS_PER_BLOCK",
      override: (value: number) => ({BLOB_SCHEDULE: [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: value}]}),
    },
  ])("$field", ({override}) => {
    it.each([0, 2 ** 32, Number.MAX_SAFE_INTEGER, Infinity])("accepts %s", (value) => {
      const config = {...mainnetChainConfig, ...override(value)};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 64, -Infinity, NaN])("rejects %s", (value) => {
      const config = {...mainnetChainConfig, ...override(value)};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidChainConfigFieldValue");
    });
  });

  it.each([0, 31, 33])("rejects a genesis validators root of length %s", (length) => {
    expect(() => new bindings.BeaconConfig(mainnetChainConfig, new Uint8Array(length))).toThrow(
      "InvalidGenesisValidatorsRootLength"
    );
  });

  it("uses a custom SHARD_COMMITTEE_PERIOD for voluntary exit validity", () => {
    const stateBytes = ssz.fulu.BeaconState.serialize(createStfState());
    const currentEpoch = computeEpochAtSlot(ssz.fulu.BeaconState.deserialize(stateBytes).slot);
    const validConfig = new bindings.BeaconConfig(
      {...stfConfig, SHARD_COMMITTEE_PERIOD: currentEpoch},
      new Uint8Array(32)
    );
    const rejectingConfig = new bindings.BeaconConfig(
      {...stfConfig, SHARD_COMMITTEE_PERIOD: currentEpoch + 1},
      new Uint8Array(32)
    );
    const exit = {
      message: {epoch: currentEpoch, validatorIndex: 0},
      signature: new Uint8Array(96),
    };
    let validState: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let rejectingState: InstanceType<typeof bindings.BeaconStateView> | undefined;

    bindings.pubkeys.ensureCapacity(16);
    try {
      validState = bindings.BeaconStateView.createFromBytes(stateBytes, validConfig);
      rejectingState = bindings.BeaconStateView.createFromBytes(stateBytes, rejectingConfig);

      expect(validState.getVoluntaryExitValidity(exit, false)).toBe("valid");
      expect(rejectingState.getVoluntaryExitValidity(exit, false)).toBe("short_time_active");
    } finally {
      rejectingState?.release();
      validState?.release();
    }
  });

  for (const [name, chainConfig] of Object.entries(networksChainConfig)) {
    if (chainConfig.PRESET_BASE !== mainnetChainConfig.PRESET_BASE) continue;

    it(`parses ${name}`, () => {
      const config = createChainForkConfig(
        name === "ephemery"
          ? {...chainConfig, DEPOSIT_CHAIN_ID: 39438000, DEPOSIT_NETWORK_ID: 39438000, MIN_GENESIS_TIME: 1638471600}
          : chainConfig
      );
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
    });
  }
});
