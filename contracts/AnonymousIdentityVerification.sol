// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, euint8, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AnonymousIdentityVerification is SepoliaConfig {

    address public owner;
    uint32 public totalVerifications;
    uint32 public activeVerificationRequests;

    struct IdentityProof {
        euint32 encryptedCredential;
        euint8 identityScore;
        bool isVerified;
        bool isActive;
        uint256 timestamp;
        uint256 expiryTime;
    }

    struct VerificationRequest {
        address requester;
        euint32 encryptedChallenge;
        euint32 submittedProof;
        bool isCompleted;
        bool isApproved;
        uint256 requestTime;
        uint256 challengeExpiryTime;
    }

    mapping(address => IdentityProof) public identityProofs;
    mapping(uint32 => VerificationRequest) public verificationRequests;
    mapping(address => bool) public authorizedVerifiers;
    mapping(address => uint32) public userRequestCounts;

    uint256 constant PROOF_VALIDITY_PERIOD = 30 days;
    uint256 constant CHALLENGE_VALIDITY_PERIOD = 1 hours;
    uint8 constant MIN_IDENTITY_SCORE = 75;
    uint32 constant MAX_REQUESTS_PER_USER = 5;

    event IdentityProofRegistered(address indexed user, uint256 timestamp);
    event VerificationRequested(uint32 indexed requestId, address indexed requester);
    event VerificationCompleted(uint32 indexed requestId, bool approved, address indexed requester);
    event VerifierAuthorized(address indexed verifier);
    event VerifierRevoked(address indexed verifier);
    event ProofExpired(address indexed user);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    modifier onlyAuthorizedVerifier() {
        require(authorizedVerifiers[msg.sender] || msg.sender == owner, "Not authorized verifier");
        _;
    }

    modifier onlyActiveProof(address user) {
        require(identityProofs[user].isActive, "No active identity proof");
        require(identityProofs[user].expiryTime > block.timestamp, "Identity proof expired");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedVerifiers[msg.sender] = true;
        totalVerifications = 0;
        activeVerificationRequests = 0;
    }

    function authorizeVerifier(address verifier) external onlyOwner {
        require(verifier != address(0), "Invalid verifier address");
        authorizedVerifiers[verifier] = true;
        emit VerifierAuthorized(verifier);
    }

    function revokeVerifier(address verifier) external onlyOwner {
        require(verifier != owner, "Cannot revoke owner");
        authorizedVerifiers[verifier] = false;
        emit VerifierRevoked(verifier);
    }

    function registerIdentityProof(uint32 credential, uint8 score) external {
        require(score >= MIN_IDENTITY_SCORE, "Identity score too low");
        require(credential > 0, "Invalid credential");

        euint32 encryptedCredential = FHE.asEuint32(credential);
        euint8 encryptedScore = FHE.asEuint8(score);

        identityProofs[msg.sender] = IdentityProof({
            encryptedCredential: encryptedCredential,
            identityScore: encryptedScore,
            isVerified: false,
            isActive: true,
            timestamp: block.timestamp,
            expiryTime: block.timestamp + PROOF_VALIDITY_PERIOD
        });

        FHE.allowThis(encryptedCredential);
        FHE.allowThis(encryptedScore);
        FHE.allow(encryptedCredential, msg.sender);
        FHE.allow(encryptedScore, msg.sender);

        emit IdentityProofRegistered(msg.sender, block.timestamp);
    }

    function requestVerification() external onlyActiveProof(msg.sender) returns (uint32 requestId) {
        require(userRequestCounts[msg.sender] < MAX_REQUESTS_PER_USER, "Request limit exceeded");
        require(!identityProofs[msg.sender].isVerified, "Already verified");

        totalVerifications++;
        activeVerificationRequests++;
        requestId = totalVerifications;

        euint32 challenge = FHE.randEuint32();

        verificationRequests[requestId] = VerificationRequest({
            requester: msg.sender,
            encryptedChallenge: challenge,
            submittedProof: FHE.asEuint32(0),
            isCompleted: false,
            isApproved: false,
            requestTime: block.timestamp,
            challengeExpiryTime: block.timestamp + CHALLENGE_VALIDITY_PERIOD
        });

        userRequestCounts[msg.sender]++;

        FHE.allowThis(challenge);
        FHE.allow(challenge, msg.sender);

        emit VerificationRequested(requestId, msg.sender);
        return requestId;
    }

    function submitVerificationProof(uint32 requestId, uint32 proofData) external {
        VerificationRequest storage request = verificationRequests[requestId];
        require(request.requester == msg.sender, "Not your request");
        require(!request.isCompleted, "Request already completed");
        require(block.timestamp <= request.challengeExpiryTime, "Challenge expired");

        euint32 encryptedProof = FHE.asEuint32(proofData);
        request.submittedProof = encryptedProof;

        FHE.allowThis(encryptedProof);
        FHE.allow(encryptedProof, msg.sender);

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = FHE.toBytes32(request.encryptedChallenge);
        cts[1] = FHE.toBytes32(encryptedProof);
        cts[2] = FHE.toBytes32(identityProofs[msg.sender].encryptedCredential);

        FHE.requestDecryption(cts, this.processVerification.selector);
    }

    function processVerification(
        uint256 requestId,
        uint32 challenge,
        uint32 proof,
        uint32 credential
    ) external {

        uint32 verificationId = uint32(requestId);
        VerificationRequest storage request = verificationRequests[verificationId];
        require(!request.isCompleted, "Request already processed");

        bool isValid = _validateProof(challenge, proof, credential);

        request.isCompleted = true;
        request.isApproved = isValid;
        activeVerificationRequests--;

        if (isValid) {
            identityProofs[request.requester].isVerified = true;
        }

        emit VerificationCompleted(verificationId, isValid, request.requester);
    }

    function _validateProof(uint32 challenge, uint32 proof, uint32 credential) private pure returns (bool) {
        uint32 expectedProof = (challenge * credential) % 1000000;
        uint32 tolerance = expectedProof / 100;

        return (proof >= expectedProof - tolerance) && (proof <= expectedProof + tolerance);
    }

    function verifyIdentityAnonymously(address user) external view onlyAuthorizedVerifier returns (bool) {
        IdentityProof storage proof = identityProofs[user];
        return proof.isVerified &&
               proof.isActive &&
               proof.expiryTime > block.timestamp;
    }

    function renewIdentityProof() external onlyActiveProof(msg.sender) {
        require(identityProofs[msg.sender].isVerified, "Must be verified first");

        identityProofs[msg.sender].expiryTime = block.timestamp + PROOF_VALIDITY_PERIOD;
        userRequestCounts[msg.sender] = 0;
    }

    function revokeIdentityProof(address user) external onlyAuthorizedVerifier {
        require(user != address(0), "Invalid user address");

        identityProofs[user].isVerified = false;
        identityProofs[user].isActive = false;

        emit ProofExpired(user);
    }

    function getIdentityStatus(address user) external view returns (
        bool isActive,
        bool isVerified,
        uint256 expiryTime,
        uint256 timestamp
    ) {
        IdentityProof storage proof = identityProofs[user];
        return (
            proof.isActive,
            proof.isVerified,
            proof.expiryTime,
            proof.timestamp
        );
    }

    function getVerificationRequestInfo(uint32 requestId) external view returns (
        address requester,
        bool isCompleted,
        bool isApproved,
        uint256 requestTime,
        uint256 challengeExpiryTime
    ) {
        VerificationRequest storage request = verificationRequests[requestId];
        return (
            request.requester,
            request.isCompleted,
            request.isApproved,
            request.requestTime,
            request.challengeExpiryTime
        );
    }

    function getContractStats() external view returns (
        uint32 totalVerificationsCount,
        uint32 activeRequests,
        uint256 currentTime
    ) {
        return (
            totalVerifications,
            activeVerificationRequests,
            block.timestamp
        );
    }

    function cleanupExpiredProofs(address[] calldata users) external onlyAuthorizedVerifier {
        for (uint i = 0; i < users.length; i++) {
            if (identityProofs[users[i]].expiryTime <= block.timestamp) {
                identityProofs[users[i]].isActive = false;
                emit ProofExpired(users[i]);
            }
        }
    }
}