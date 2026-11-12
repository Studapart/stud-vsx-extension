# 0001. Release notes are read in the publish job

Status: accepted

The build job runs npm with a read-only token. The publish job holds the write token and runs no npm. Release notes used to be written into the build artifact before npm ran, so a dependency could replace the text that publish attached to the release. The archive has to come from that build. The notes do not.

`build` uploads only `stud-<version>.vsix`. `publish` checks out the same commit, runs `scripts/release-notes.sh`, and passes that text to `gh release create --notes`.

A draft is deleted and the run is repeated. Publishing the draft would create a release that does not contain this run's archive.
