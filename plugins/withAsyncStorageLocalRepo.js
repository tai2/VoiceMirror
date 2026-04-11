const { withProjectBuildGradle } = require("@expo/config-plugins");

// @react-native-async-storage/async-storage v3 ships a native artifact
// (org.asyncstorage.shared_storage:storage-android) only as a local maven
// repository inside its node_modules package. We need to register that
// local_repo with Gradle so :app can resolve the dependency.
const LOCAL_REPO_BLOCK = `    maven {
      url = uri("$rootDir/../node_modules/@react-native-async-storage/async-storage/android/local_repo")
    }`;

function addLocalRepoToAllProjects(contents) {
  if (contents.includes("async-storage/android/local_repo")) {
    return contents;
  }
  return contents.replace(
    /allprojects\s*\{\s*repositories\s*\{([\s\S]*?)\n\s*\}\s*\}/,
    (match, inner) => {
      return match.replace(inner, `${inner}\n${LOCAL_REPO_BLOCK}`);
    },
  );
}

module.exports = function withAsyncStorageLocalRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "withAsyncStorageLocalRepo only supports groovy build.gradle",
      );
    }
    config.modResults.contents = addLocalRepoToAllProjects(
      config.modResults.contents,
    );
    return config;
  });
};
