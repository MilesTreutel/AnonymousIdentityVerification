// Contract Configuration
const CONTRACT_ADDRESS = '0x813F34aa27F893C45f419dd9d32561a2639A8E15';
const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111 in hex
const SEPOLIA_NETWORK_CONFIG = {
    chainId: SEPOLIA_CHAIN_ID,
    chainName: 'Sepolia Test Network',
    nativeCurrency: {
        name: 'Sepolia ETH',
        symbol: 'SEP',
        decimals: 18
    },
    rpcUrls: ['https://rpc.sepolia.org', 'https://sepolia.infura.io/v3/'],
    blockExplorerUrls: ['https://sepolia.etherscan.io/']
};

const CONTRACT_ABI = [
    // Events
    "event IdentityProofRegistered(address indexed user, uint256 timestamp)",
    "event VerificationRequested(uint32 indexed requestId, address indexed requester)",
    "event VerificationCompleted(uint32 indexed requestId, bool approved, address indexed requester)",
    "event VerifierAuthorized(address indexed verifier)",
    "event VerifierRevoked(address indexed verifier)",
    "event ProofExpired(address indexed user)",

    // View Functions
    "function owner() view returns (address)",
    "function totalVerifications() view returns (uint32)",
    "function activeVerificationRequests() view returns (uint32)",
    "function authorizedVerifiers(address) view returns (bool)",
    "function getIdentityStatus(address user) view returns (bool isActive, bool isVerified, uint256 expiryTime, uint256 timestamp)",
    "function getVerificationRequestInfo(uint32 requestId) view returns (address requester, bool isCompleted, bool isApproved, uint256 requestTime, uint256 challengeExpiryTime)",
    "function getContractStats() view returns (uint32 totalVerificationsCount, uint32 activeRequests, uint256 currentTime)",
    "function verifyIdentityAnonymously(address user) view returns (bool)",

    // Write Functions
    "function registerIdentityProof(uint32 credential, uint8 score)",
    "function requestVerification() returns (uint32 requestId)",
    "function submitVerificationProof(uint32 requestId, uint32 proofData)",
    "function renewIdentityProof()",
    "function authorizeVerifier(address verifier)",
    "function revokeVerifier(address verifier)",
    "function revokeIdentityProof(address user)",
    "function cleanupExpiredProofs(address[] calldata users)"
];

// Global Variables
let provider;
let signer;
let contract;
let userAddress;

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    setupEventListeners();
    await checkWalletConnection();
}

// Event Listeners Setup
function setupEventListeners() {
    // Wallet Connection
    document.getElementById('connectWallet').addEventListener('click', connectWallet);

    // Tab Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });

    // Register Identity Form
    document.getElementById('registerForm').addEventListener('submit', handleRegisterIdentity);

    // Verification Functions
    document.getElementById('requestVerification').addEventListener('click', handleRequestVerification);
    document.getElementById('proofForm').addEventListener('submit', handleSubmitProof);

    // Status Functions
    document.getElementById('checkStatus').addEventListener('click', handleCheckStatus);
    document.getElementById('renewProof').addEventListener('click', handleRenewProof);
    document.getElementById('checkRequestStatus').addEventListener('click', handleCheckRequestStatus);

    // Admin Functions
    document.getElementById('authorizeVerifier').addEventListener('click', handleAuthorizeVerifier);
    document.getElementById('revokeVerifier').addEventListener('click', handleRevokeVerifier);
    document.getElementById('verifyIdentity').addEventListener('click', handleVerifyIdentity);
    document.getElementById('getStats').addEventListener('click', handleGetStats);
}

// Wallet Functions
async function checkWalletConnection() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                await connectWallet();
            }
        } catch (error) {
            console.error('Error checking wallet connection:', error);
        }
    }
}

async function connectWallet() {
    try {
        // 1. Detection: Check window.ethereum (MetaMask provider)
        if (typeof window.ethereum === 'undefined') {
            showResult('walletInfo', '⚠️ Please install MetaMask to use this application.', 'error');
            return;
        }

        if (!window.ethereum.isMetaMask) {
            showResult('walletInfo', '⚠️ This application only supports MetaMask wallet.', 'error');
            return;
        }

        showLoading(true);

        // 2. Request Access: Use eth_requestAccounts to get user permission
        await window.ethereum.request({ method: 'eth_requestAccounts' });

        // 3. Network Verification: Check connection to Sepolia testnet
        const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });

        if (currentChainId !== SEPOLIA_CHAIN_ID) {
            // 4. Network Switch: Automatically switch/add Sepolia if needed
            await switchToSepolia();
        }

        // 5. Provider Setup: Create ethers.js v6 BrowserProvider and signer
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // 6. Contract Initialization: Create contract instance
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        // 7. State Update: Update React state with account and contract
        updateConnectionStatus(true);
        document.getElementById('userAddress').textContent = userAddress;

        // Get network info
        const network = await provider.getNetwork();
        document.getElementById('networkName').textContent = getNetworkName(network.chainId);

        document.getElementById('walletInfo').classList.remove('hidden');
        document.getElementById('connectWallet').textContent = 'Connected to MetaMask';
        document.getElementById('connectWallet').disabled = true;

        // Success Handling: Show success message
        showResult('walletInfo', '✅ Successfully connected to Sepolia testnet!', 'success');

        // Get Initial State: Load user's current status
        await loadInitialState();

        showLoading(false);
    } catch (error) {
        console.error('Error connecting wallet:', error);
        showResult('walletInfo', `❌ Connection failed: ${getErrorMessage(error)}`, 'error');
        showLoading(false);
    }
}

async function switchToSepolia() {
    try {
        // Try to switch to Sepolia
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
    } catch (switchError) {
        // If the chain is not added, add it
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [SEPOLIA_NETWORK_CONFIG],
                });
            } catch (addError) {
                throw new Error('Failed to add Sepolia network to MetaMask');
            }
        } else {
            throw new Error('Failed to switch to Sepolia network');
        }
    }
}

async function loadInitialState() {
    try {
        if (!contract || !userAddress) return;

        // Check user's identity status
        const status = await contract.getIdentityStatus(userAddress);

        if (status.isActive) {
            // Update status tab with current information
            document.getElementById('isActive').textContent = status.isActive ? '✅ Yes' : '❌ No';
            document.getElementById('isVerified').textContent = status.isVerified ? '✅ Verified' : '❌ Not Verified';
            document.getElementById('registrationTime').textContent = formatTimestamp(status.timestamp);
            document.getElementById('expiryTime').textContent = formatTimestamp(status.expiryTime);

            showResult('walletInfo', '✅ Connected to Sepolia! Identity proof found.', 'success');
        } else {
            showResult('walletInfo', '✅ Connected to Sepolia! Ready to register identity.', 'info');
        }
    } catch (error) {
        console.error('Error loading initial state:', error);
        // Don't show error for initial state loading
    }
}

function updateConnectionStatus(connected) {
    const statusIndicator = document.getElementById('statusIndicator');
    const connectionText = document.getElementById('connectionText');

    if (connected) {
        statusIndicator.classList.add('connected');
        connectionText.textContent = 'Connected';
    } else {
        statusIndicator.classList.remove('connected');
        connectionText.textContent = 'Not Connected';
    }
}

function getNetworkName(chainId) {
    const networks = {
        1n: 'Ethereum Mainnet',
        11155111n: 'Sepolia Testnet',
        8009n: 'Zama Devnet',
        1337n: 'Localhost'
    };
    return networks[BigInt(chainId)] || `Chain ID: ${chainId}`;
}

// Tab Management
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
}

// Identity Registration
async function handleRegisterIdentity(e) {
    e.preventDefault();

    if (!contract) {
        showResult('registerResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const credential = parseInt(document.getElementById('credential').value);
    const score = parseInt(document.getElementById('score').value);

    if (score < 75) {
        showResult('registerResult', 'Identity score must be at least 75.', 'error');
        return;
    }

    try {
        showLoading(true);

        const tx = await contract.registerIdentityProof(credential, score);
        showResult('registerResult', `Transaction submitted: ${tx.hash}`, 'info');

        await tx.wait();
        showResult('registerResult', 'Identity proof registered successfully!', 'success');

        // Reset form
        document.getElementById('registerForm').reset();

    } catch (error) {
        console.error('Registration error:', error);
        showResult('registerResult', `Registration failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Verification Request
async function handleRequestVerification() {
    if (!contract) {
        showResult('verificationResult', 'Please connect your wallet first.', 'error');
        return;
    }

    try {
        showLoading(true);

        const tx = await contract.requestVerification();
        showResult('verificationResult', `Transaction submitted: ${tx.hash}`, 'info');

        const receipt = await tx.wait();

        // Extract request ID from events (ethers v6 syntax)
        const event = receipt.logs?.find(log => {
            try {
                const parsed = contract.interface.parseLog(log);
                return parsed.name === 'VerificationRequested';
            } catch (e) {
                return false;
            }
        });

        if (event) {
            const parsed = contract.interface.parseLog(event);
            const requestId = parsed.args.requestId.toString();
            document.getElementById('requestId').value = requestId;
            document.getElementById('challengeSection').classList.remove('hidden');
            showResult('verificationResult', `Verification requested! Request ID: ${requestId}`, 'success');
        } else {
            showResult('verificationResult', 'Verification requested successfully!', 'success');
        }

    } catch (error) {
        console.error('Verification request error:', error);
        showResult('verificationResult', `Request failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Submit Proof
async function handleSubmitProof(e) {
    e.preventDefault();

    if (!contract) {
        showResult('verificationResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const requestId = parseInt(document.getElementById('requestId').value);
    const proofData = parseInt(document.getElementById('proofData').value);

    try {
        showLoading(true);

        const tx = await contract.submitVerificationProof(requestId, proofData);
        showResult('verificationResult', `Proof submitted: ${tx.hash}`, 'info');

        await tx.wait();
        showResult('verificationResult', 'Verification proof submitted successfully!', 'success');

        // Hide challenge section and reset form
        document.getElementById('challengeSection').classList.add('hidden');
        document.getElementById('proofForm').reset();

    } catch (error) {
        console.error('Proof submission error:', error);
        showResult('verificationResult', `Submission failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Check Status
async function handleCheckStatus() {
    if (!contract || !userAddress) {
        showResult('statusResult', 'Please connect your wallet first.', 'error');
        return;
    }

    try {
        showLoading(true);

        const status = await contract.getIdentityStatus(userAddress);

        document.getElementById('isActive').textContent = status.isActive ? '✅ Yes' : '❌ No';
        document.getElementById('isVerified').textContent = status.isVerified ? '✅ Verified' : '❌ Not Verified';
        document.getElementById('registrationTime').textContent = formatTimestamp(status.timestamp);
        document.getElementById('expiryTime').textContent = formatTimestamp(status.expiryTime);

        document.getElementById('statusDetails').classList.remove('hidden');
        showResult('statusResult', 'Status retrieved successfully!', 'success');

    } catch (error) {
        console.error('Status check error:', error);
        showResult('statusResult', `Status check failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Renew Proof
async function handleRenewProof() {
    if (!contract) {
        showResult('statusResult', 'Please connect your wallet first.', 'error');
        return;
    }

    try {
        showLoading(true);

        const tx = await contract.renewIdentityProof();
        showResult('statusResult', `Transaction submitted: ${tx.hash}`, 'info');

        await tx.wait();
        showResult('statusResult', 'Identity proof renewed successfully!', 'success');

        // Refresh status
        await handleCheckStatus();

    } catch (error) {
        console.error('Renewal error:', error);
        showResult('statusResult', `Renewal failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Check Request Status
async function handleCheckRequestStatus() {
    if (!contract) {
        showResult('requestStatusResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const requestId = parseInt(document.getElementById('requestIdCheck').value);
    if (!requestId) {
        showResult('requestStatusResult', 'Please enter a request ID.', 'error');
        return;
    }

    try {
        showLoading(true);

        const requestInfo = await contract.getVerificationRequestInfo(requestId);

        let statusText = `
            <strong>Requester:</strong> ${requestInfo.requester}<br>
            <strong>Completed:</strong> ${requestInfo.isCompleted ? 'Yes' : 'No'}<br>
            <strong>Approved:</strong> ${requestInfo.isApproved ? 'Yes' : 'No'}<br>
            <strong>Request Time:</strong> ${formatTimestamp(requestInfo.requestTime)}<br>
            <strong>Challenge Expiry:</strong> ${formatTimestamp(requestInfo.challengeExpiryTime)}
        `;

        showResult('requestStatusResult', statusText, 'info');

    } catch (error) {
        console.error('Request status error:', error);
        showResult('requestStatusResult', `Request status check failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Admin Functions
async function handleAuthorizeVerifier() {
    if (!contract) {
        showResult('adminResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const verifierAddress = document.getElementById('verifierAddress').value;
    if (!ethers.isAddress(verifierAddress)) {
        showResult('adminResult', 'Please enter a valid address.', 'error');
        return;
    }

    try {
        showLoading(true);

        const tx = await contract.authorizeVerifier(verifierAddress);
        showResult('adminResult', `Transaction submitted: ${tx.hash}`, 'info');

        await tx.wait();
        showResult('adminResult', 'Verifier authorized successfully!', 'success');

        document.getElementById('verifierAddress').value = '';

    } catch (error) {
        console.error('Authorization error:', error);
        showResult('adminResult', `Authorization failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function handleRevokeVerifier() {
    if (!contract) {
        showResult('adminResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const revokeAddress = document.getElementById('revokeAddress').value;
    if (!ethers.isAddress(revokeAddress)) {
        showResult('adminResult', 'Please enter a valid address.', 'error');
        return;
    }

    try {
        showLoading(true);

        const tx = await contract.revokeVerifier(revokeAddress);
        showResult('adminResult', `Transaction submitted: ${tx.hash}`, 'info');

        await tx.wait();
        showResult('adminResult', 'Verifier revoked successfully!', 'success');

        document.getElementById('revokeAddress').value = '';

    } catch (error) {
        console.error('Revocation error:', error);
        showResult('adminResult', `Revocation failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function handleVerifyIdentity() {
    if (!contract) {
        showResult('adminResult', 'Please connect your wallet first.', 'error');
        return;
    }

    const userAddr = document.getElementById('verifyUserAddress').value;
    if (!ethers.isAddress(userAddr)) {
        showResult('adminResult', 'Please enter a valid address.', 'error');
        return;
    }

    try {
        showLoading(true);

        const isVerified = await contract.verifyIdentityAnonymously(userAddr);
        showResult('adminResult', `Identity verification result: ${isVerified ? 'VERIFIED ✅' : 'NOT VERIFIED ❌'}`, isVerified ? 'success' : 'error');

        document.getElementById('verifyUserAddress').value = '';

    } catch (error) {
        console.error('Verification error:', error);
        showResult('adminResult', `Verification failed: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function handleGetStats() {
    if (!contract) {
        showResult('statsResult', 'Please connect your wallet first.', 'error');
        return;
    }

    try {
        showLoading(true);

        const stats = await contract.getContractStats();

        let statsText = `
            <strong>Total Verifications:</strong> ${stats.totalVerificationsCount.toString()}<br>
            <strong>Active Requests:</strong> ${stats.activeRequests.toString()}<br>
            <strong>Current Timestamp:</strong> ${formatTimestamp(stats.currentTime)}
        `;

        showResult('statsResult', statsText, 'info');

    } catch (error) {
        console.error('Stats error:', error);
        showResult('statsResult', `Failed to get stats: ${getErrorMessage(error)}`, 'error');
    } finally {
        showLoading(false);
    }
}

// Utility Functions
function showResult(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.innerHTML = message;
    element.className = `result ${type}`;
    element.classList.remove('hidden');

    // Auto-hide after 10 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            element.classList.add('hidden');
        }, 10000);
    }
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function formatTimestamp(timestamp) {
    if (timestamp == 0 || timestamp == 0n) return 'Not set';
    // Handle both regular numbers and BigInt
    const timestampNumber = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp;
    const date = new Date(timestampNumber * 1000);
    return date.toLocaleString();
}

function getErrorMessage(error) {
    if (error.reason) return error.reason;
    if (error.message) return error.message;
    return error.toString();
}

// Handle account changes
if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on('accountsChanged', function (accounts) {
        if (accounts.length === 0) {
            // User disconnected
            updateConnectionStatus(false);
            document.getElementById('walletInfo').classList.add('hidden');
            document.getElementById('connectWallet').textContent = 'Connect MetaMask';
            document.getElementById('connectWallet').disabled = false;
            contract = null;
            userAddress = null;
            showResult('walletInfo', '⚠️ MetaMask disconnected. Please reconnect to continue.', 'error');
        } else {
            // User changed account
            showResult('walletInfo', '🔄 Account changed. Reconnecting...', 'info');
            connectWallet();
        }
    });

    window.ethereum.on('chainChanged', function (chainId) {
        if (chainId !== SEPOLIA_CHAIN_ID) {
            showResult('walletInfo', '⚠️ Please switch back to Sepolia testnet to continue using the application.', 'error');
            updateConnectionStatus(false);
        } else {
            // Reconnect when switched back to Sepolia
            connectWallet();
        }
    });
}